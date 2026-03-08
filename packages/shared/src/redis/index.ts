import { Redis } from "ioredis";

export function createRedisClient(url?: string): Redis {
  const redis = new Redis(url ?? process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  });

  redis.on("error", (err: Error) => {
    console.error("Redis connection error", err);
  });

  return redis;
}

export const REDIS_KEYS = {
  vpaMapping: (vpa: string) => `vpa:${vpa}` as const,
  txnLock: (txnId: string) => `lock:txn:${txnId}` as const,
  orgRateLimit: (orgId: string) => `rl:org:${orgId}` as const,
  txnIdempotency: (key: string) => `idem:${key}` as const,
} as const;

export { checkRateLimit, type RateLimitResult } from "./rate-limiter.js";
