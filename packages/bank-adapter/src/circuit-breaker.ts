import type pino from "pino";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  failureWindowMs: number;
  cooldownMs: number;
  halfOpenMaxAttempts: number;
}

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitOpenError extends Error {
  constructor(bankOrgId: string) {
    super(`Circuit breaker OPEN for bank ${bankOrgId}`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private readonly failures: Int32Array;
  private failHead = 0;
  private failCount = 0;
  private openedAt = 0;
  private halfOpenSuccesses = 0;
  private lastUsedAt = Date.now();

  constructor(
    private readonly bankOrgId: string,
    private readonly config: CircuitBreakerConfig,
    private readonly logger: pino.Logger,
  ) {
    this.failures = new Int32Array(config.failureThreshold + 1);
  }

  getState(): CircuitState {
    return this.state;
  }

  getLastUsedAt(): number {
    return this.lastUsedAt;
  }

  canExecute(): boolean {
    this.lastUsedAt = Date.now();

    if (this.state === "CLOSED") return true;

    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt >= this.config.cooldownMs) {
        this.state = "HALF_OPEN";
        this.halfOpenSuccesses = 0;
        this.logger.info({ bankOrgId: this.bankOrgId }, "Circuit breaker HALF_OPEN");
        return true;
      }
      return false;
    }

    return true;
  }

  recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenMaxAttempts) {
        this.state = "CLOSED";
        this.failCount = 0;
        this.logger.info({ bankOrgId: this.bankOrgId }, "Circuit breaker CLOSED");
      }
    }
  }

  recordFailure(): void {
    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.logger.warn({ bankOrgId: this.bankOrgId }, "Circuit breaker OPEN (failed in HALF_OPEN)");
      return;
    }

    const now = Date.now();
    const capacity = this.failures.length;
    const tail = (this.failHead + this.failCount) % capacity;
    this.failures[tail] = now & 0x7fffffff;

    if (this.failCount < capacity) {
      this.failCount++;
    } else {
      this.failHead = (this.failHead + 1) % capacity;
    }

    this.pruneFailures(now);

    if (this.failCount >= this.config.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = now;
      this.logger.warn(
        { bankOrgId: this.bankOrgId, failures: this.failCount },
        "Circuit breaker OPEN",
      );
    }
  }

  private pruneFailures(now: number): void {
    const cutoff = (now - this.config.failureWindowMs) & 0x7fffffff;
    while (this.failCount > 0) {
      const headTs = this.failures[this.failHead]!;
      if (headTs < cutoff && (cutoff - headTs) < 0x3fffffff) {
        this.failHead = (this.failHead + 1) % this.failures.length;
        this.failCount--;
      } else {
        break;
      }
    }
  }
}

export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly evictionIntervalMs: number;
  private readonly maxIdleMs: number;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly logger: pino.Logger,
    evictionIntervalMs = 60_000,
    maxIdleMs = 300_000,
  ) {
    this.evictionIntervalMs = evictionIntervalMs;
    this.maxIdleMs = maxIdleMs;
    this.evictionTimer = setInterval(() => this.evict(), this.evictionIntervalMs);
    this.evictionTimer.unref();
  }

  getBreaker(bankOrgId: string): CircuitBreaker {
    let breaker = this.breakers.get(bankOrgId);
    if (!breaker) {
      breaker = new CircuitBreaker(bankOrgId, this.config, this.logger);
      this.breakers.set(bankOrgId, breaker);
    }
    return breaker;
  }

  destroy(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  private evict(): void {
    const now = Date.now();
    for (const [id, breaker] of this.breakers) {
      if (now - breaker.getLastUsedAt() > this.maxIdleMs) {
        this.breakers.delete(id);
        this.logger.debug({ bankOrgId: id }, "Evicted idle circuit breaker");
      }
    }
  }
}
