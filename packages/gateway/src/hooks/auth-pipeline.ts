import type { FastifyRequest } from "fastify";
import type pino from "pino";
import { verifySignature } from "@repo/shared/crypto";
import { REDIS_KEYS, checkRateLimit } from "@repo/shared/redis";
import {
  PayRequestSchema,
  CollectRequestSchema,
  TxnStatusQuerySchema,
} from "@repo/shared/schemas";
import {
  ValidationError,
  AuthError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
} from "@repo/shared/errors";
import type { GatewayDeps } from "../deps.js";
import type { OrgCache } from "./org-cache.js";
import type { RegisteredOrg } from "@repo/shared/db/types";

export interface MessageEnvelope {
  header: { msgId: string; orgId: string; ts: string };
  msgType: string;
  body: unknown;
  signature: string;
}

const SCHEMA_MAP: Record<string, { parse: (data: unknown) => unknown }> = {
  PAY_REQUEST: PayRequestSchema,
  COLLECT_REQUEST: CollectRequestSchema,
  TXN_STATUS_QUERY: TxnStatusQuerySchema,
};

const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

export function createAuthPipeline(
  deps: GatewayDeps,
  orgCache: OrgCache,
  logger: pino.Logger,
) {
  return async function authPipeline(
    request: FastifyRequest,
  ): Promise<{ org: RegisteredOrg; validatedBody: unknown }> {
    const envelope = request.body as MessageEnvelope;

    // 1. Parse envelope
    if (!envelope?.header || !envelope.msgType || !envelope.signature) {
      throw new ValidationError("Invalid message envelope");
    }

    // 2. Cert fingerprint check
    const fingerprint = request.headers["x-client-cert-fingerprint"] as string;
    let org: RegisteredOrg | undefined;
    if (fingerprint) {
      org = orgCache.getByFingerprint(fingerprint);
    }

    // 3. Org lookup by header.orgId
    if (!org) {
      org = orgCache.getByOrgId(envelope.header.orgId);
    }
    if (!org) {
      throw new AuthError("Unknown organization");
    }

    // 4. IP whitelist
    if (org.ipWhitelist && org.ipWhitelist.length > 0) {
      const clientIp = request.ip;
      if (!org.ipWhitelist.includes(clientIp)) {
        logger.warn({ orgId: org.orgId, clientIp }, "IP not whitelisted");
        throw new ForbiddenError("IP not whitelisted");
      }
    }

    // 5. Signature verification
    if (!org.publicKeyPem) {
      logger.warn({ orgId: org.orgId }, "Org has no public key configured");
      throw new AuthError("Organization not configured for signature verification");
    }
    const payload = JSON.stringify(envelope.body);
    const valid = verifySignature(org.publicKeyPem, payload, envelope.signature);
    if (!valid) {
      throw new AuthError("Invalid signature");
    }

    // 6. Timestamp freshness
    const msgTime = new Date(envelope.header.ts).getTime();
    if (Number.isNaN(msgTime)) {
      throw new ValidationError("Invalid timestamp format");
    }
    const now = Date.now();
    if (Math.abs(now - msgTime) > FRESHNESS_WINDOW_MS) {
      throw new ValidationError("Message timestamp too old or in the future");
    }

    // 7. Message ID dedup
    const dedupKey = REDIS_KEYS.txnIdempotency(envelope.header.msgId);
    const isNew = await deps.redis.set(dedupKey, "1", "EX", 600, "NX");
    if (!isNew) {
      throw new ConflictError("Duplicate message ID");
    }

    // 8. Rate limiting (token bucket via Redis Lua)
    const rlKey = REDIS_KEYS.orgRateLimit(org.orgId);
    const rlResult = await checkRateLimit(deps.redis, rlKey, org.maxTps);
    if (!rlResult.allowed) {
      throw new RateLimitError("Rate limit exceeded", rlResult.retryAfterMs);
    }

    // 9. Schema validation
    const validator = SCHEMA_MAP[envelope.msgType];
    if (!validator) {
      throw new ValidationError(`Unknown message type: ${envelope.msgType}`);
    }
    const validatedBody = validator.parse(envelope.body);

    return { org, validatedBody };
  };
}
