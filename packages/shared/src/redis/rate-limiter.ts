import type { Redis } from "ioredis";

// Token bucket via Lua — atomic, no race conditions.
// Tokens refill continuously at `rate` tokens/sec up to `capacity`.
// Returns { allowed: true, remaining } or { allowed: false, retryAfterMs }.
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  last_refill = now
end

local elapsed = math.max(0, now - last_refill)
tokens = math.min(capacity, tokens + elapsed * rate)

if tokens >= requested then
  tokens = tokens - requested
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('EXPIRE', key, math.ceil(capacity / rate) + 1)
  return {1, math.floor(tokens)}
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('EXPIRE', key, math.ceil(capacity / rate) + 1)
  local wait = math.ceil((requested - tokens) / rate * 1000)
  return {0, wait}
end
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export async function checkRateLimit(
  redis: Redis,
  key: string,
  maxTps: number,
  burstCapacity?: number,
): Promise<RateLimitResult> {
  const capacity = burstCapacity ?? maxTps;
  const nowSec = Date.now() / 1000;

  const result = (await redis.eval(
    TOKEN_BUCKET_LUA,
    1,
    key,
    capacity,
    maxTps,
    nowSec,
    1,
  )) as [number, number];

  if (result[0] === 1) {
    return { allowed: true, remaining: result[1], retryAfterMs: 0 };
  }
  return { allowed: false, remaining: 0, retryAfterMs: result[1] };
}
