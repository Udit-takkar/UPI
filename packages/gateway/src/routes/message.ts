import type { FastifyInstance, FastifyRequest } from "fastify";
import type pino from "pino";
import { sendMessage } from "@repo/shared/kafka";
import { TOPICS } from "@repo/shared/kafka";
import { ValidationError } from "@repo/shared/errors";
import type { GatewayDeps } from "../deps.js";
import type { OrgCache } from "../hooks/org-cache.js";
import type { MessageEnvelope } from "../hooks/auth-pipeline.js";

const MSG_TYPE_TO_TOPIC: Record<string, string> = {
  PAY_REQUEST: TOPICS.PAY_REQUEST,
  COLLECT_REQUEST: TOPICS.COLLECT_REQUEST,
  TXN_STATUS_QUERY: TOPICS.STATUS_QUERY,
};

interface MessageRouteOpts {
  deps: GatewayDeps;
  orgCache: OrgCache;
  authPipeline: (request: FastifyRequest) => Promise<{ org: { orgId: string }; validatedBody: unknown }>;
  logger: pino.Logger;
}

export async function messageRoute(app: FastifyInstance, opts: MessageRouteOpts) {
  const { deps, authPipeline, logger } = opts;

  app.post("/api/v1/message", async (request, reply) => {
    const { org, validatedBody } = await authPipeline(request);

    const envelope = request.body as MessageEnvelope;
    const topic = MSG_TYPE_TO_TOPIC[envelope.msgType];
    if (!topic) {
      throw new ValidationError(`No topic for message type: ${envelope.msgType}`);
    }

    await sendMessage(
      deps.kafkaProducer,
      topic as Parameters<typeof sendMessage>[1],
      envelope.header.msgId,
      {
        header: envelope.header,
        msgType: envelope.msgType,
        body: validatedBody,
        orgId: org.orgId,
      },
    );

    logger.info(
      { msgId: envelope.header.msgId, msgType: envelope.msgType, orgId: org.orgId },
      "Message accepted",
    );

    return reply.status(202).send({ msgId: envelope.header.msgId, status: "ACCEPTED" });
  });
}
