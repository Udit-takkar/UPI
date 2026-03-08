import { LRUCache } from "lru-cache";
import type { Redis } from "ioredis";
import type { Database } from "@repo/shared/db";
import { schema } from "@repo/shared/db";
import { REDIS_KEYS } from "@repo/shared/redis";
import { eq } from "drizzle-orm";
import type pino from "pino";

export interface ResolvedVpa {
  vpaAddress: string;
  handle: string;
  ifsc: string;
  bankOrgId: string;
  pspOrgId: string;
  accountNumberEncrypted: string;
}

const REDIS_TTL_SECONDS = 300;
const LRU_MAX = 10_000;
const LRU_TTL_MS = 60_000;

export function createVpaCache(db: Database, redis: Redis, logger: pino.Logger) {
  const lru = new LRUCache<string, ResolvedVpa>({
    max: LRU_MAX,
    ttl: LRU_TTL_MS,
  });

  async function resolve(vpaAddress: string): Promise<ResolvedVpa | null> {
    const cached = lru.get(vpaAddress);
    if (cached) {
      logger.debug({ vpa: vpaAddress }, "VPA cache hit (LRU)");
      return cached;
    }

    const redisKey = REDIS_KEYS.vpaMapping(vpaAddress);
    const redisVal = await redis.get(redisKey);
    if (redisVal) {
      try {
        const resolved: ResolvedVpa = JSON.parse(redisVal);
        logger.debug({ vpa: vpaAddress }, "VPA cache hit (Redis)");
        lru.set(vpaAddress, resolved);
        return resolved;
      } catch {
        logger.warn({ vpa: vpaAddress }, "Corrupt Redis cache entry, falling through to DB");
        await redis.del(redisKey);
      }
    }

    const row = await db.query.vpaMappings.findFirst({
      where: eq(schema.vpaMappings.vpaAddress, vpaAddress),
    });

    if (!row || row.status !== "ACTIVE") {
      logger.debug({ vpa: vpaAddress }, "VPA not found or inactive");
      return null;
    }

    const resolved: ResolvedVpa = {
      vpaAddress: row.vpaAddress,
      handle: row.handle,
      ifsc: row.ifsc,
      bankOrgId: row.bankOrgId,
      pspOrgId: row.pspOrgId,
      accountNumberEncrypted: row.accountNumberEncrypted,
    };

    await redis.set(redisKey, JSON.stringify(resolved), "EX", REDIS_TTL_SECONDS);
    lru.set(vpaAddress, resolved);
    logger.debug({ vpa: vpaAddress }, "VPA resolved from DB, cached");
    return resolved;
  }

  function invalidate(vpaAddress: string): void {
    lru.delete(vpaAddress);
    redis.del(REDIS_KEYS.vpaMapping(vpaAddress)).catch((err) => {
      logger.warn({ vpa: vpaAddress, err }, "Failed to invalidate VPA Redis cache");
    });
  }

  function warmLru(entries: ResolvedVpa[]): void {
    for (const entry of entries) {
      lru.set(entry.vpaAddress, entry);
    }
    logger.info({ count: entries.length }, "VPA LRU cache warmed");
  }

  return { resolve, invalidate, warmLru };
}

export type VpaCache = ReturnType<typeof createVpaCache>;
