import type pino from "pino";
import {
  CircuitBreakerRegistry,
  CircuitOpenError,
  type CircuitBreakerConfig,
} from "./circuit-breaker.js";
import {
  BulkheadRegistry,
  type BulkheadConfig,
} from "./bulkhead.js";
import {
  AdaptiveTimeoutRegistry,
  type AdaptiveTimeoutConfig,
} from "./adaptive-timeout.js";

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  retryableStatusCodes: number[];
}

export interface ResilienceConfig {
  circuitBreaker: CircuitBreakerConfig;
  bulkhead: BulkheadConfig;
  adaptiveTimeout: AdaptiveTimeoutConfig;
  retry: RetryConfig;
}

export interface ResilienceMetrics {
  onSuccess(bankOrgId: string, durationMs: number, attempt: number): void;
  onFailure(bankOrgId: string, error: string, attempt: number): void;
  onCircuitOpen(bankOrgId: string): void;
  onBulkheadRejected(bankOrgId: string): void;
  onTimeout(bankOrgId: string, timeoutMs: number): void;
}

const noopMetrics: ResilienceMetrics = {
  onSuccess() {},
  onFailure() {},
  onCircuitOpen() {},
  onBulkheadRejected() {},
  onTimeout() {},
};

export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  circuitBreaker: {
    failureThreshold: 5,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    halfOpenMaxAttempts: 3,
  },
  bulkhead: {
    maxConcurrent: 10,
    maxQueueSize: 50,
    queueTimeoutMs: 5_000,
  },
  adaptiveTimeout: {
    windowMs: 5 * 60_000,
    minTimeoutMs: 3_000,
    maxTimeoutMs: 30_000,
    defaultTimeoutMs: 10_000,
    percentile: 0.95,
    multiplier: 1.5,
    minSamples: 10,
  },
  retry: {
    maxRetries: 2,
    baseDelayMs: 200,
    retryableStatusCodes: [502, 503, 504],
  },
};

export class BankCallError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "BankCallError";
    this.statusCode = statusCode;
  }
}

export class ResilienceLayer {
  private readonly breakers: CircuitBreakerRegistry;
  private readonly bulkheads: BulkheadRegistry;
  private readonly timeouts: AdaptiveTimeoutRegistry;
  private readonly metrics: ResilienceMetrics;
  private inflightCount = 0;
  private drainResolve: (() => void) | null = null;

  constructor(
    private readonly config: ResilienceConfig,
    private readonly logger: pino.Logger,
    metrics?: ResilienceMetrics,
  ) {
    this.breakers = new CircuitBreakerRegistry(config.circuitBreaker, logger);
    this.bulkheads = new BulkheadRegistry(config.bulkhead);
    this.timeouts = new AdaptiveTimeoutRegistry(config.adaptiveTimeout);
    this.metrics = metrics ?? noopMetrics;
  }

  async execute<T>(
    bankOrgId: string,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const breaker = this.breakers.getBreaker(bankOrgId);

    if (!breaker.canExecute()) {
      this.metrics.onCircuitOpen(bankOrgId);
      throw new CircuitOpenError(bankOrgId);
    }

    const bulkhead = this.bulkheads.getBulkhead(bankOrgId);
    const release = await bulkhead.acquire();

    this.inflightCount++;

    try {
      const adaptiveTimeout = this.timeouts.getTimeout(bankOrgId);
      const timeoutMs = adaptiveTimeout.getTimeoutMs();

      let lastErr: unknown;
      let attempts = 0;

      for (let attempt = 0; attempt <= this.config.retry.maxRetries; attempt++) {
        attempts = attempt;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const start = Date.now();

        try {
          const result = await fn(controller.signal);
          const duration = Date.now() - start;

          clearTimeout(timer);
          breaker.recordSuccess();
          adaptiveTimeout.record(duration);
          this.metrics.onSuccess(bankOrgId, duration, attempt);

          return result;
        } catch (err) {
          clearTimeout(timer);
          lastErr = err;

          if (this.isTimeout(err)) {
            this.metrics.onTimeout(bankOrgId, timeoutMs);
          }

          if (attempt < this.config.retry.maxRetries && this.isRetryable(err)) {
            const delay = this.config.retry.baseDelayMs * 2 ** attempt;
            this.logger.warn(
              { bankOrgId, attempt, delay, err },
              "Bank call failed, retrying",
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          break;
        }
      }

      breaker.recordFailure();
      this.metrics.onFailure(bankOrgId, String(lastErr), attempts);
      throw lastErr;
    } finally {
      this.inflightCount--;
      release();

      if (this.inflightCount === 0 && this.drainResolve) {
        this.drainResolve();
      }
    }
  }

  drain(timeoutMs = 30_000): Promise<void> {
    if (this.inflightCount === 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.logger.warn(
          { inflight: this.inflightCount },
          "Drain timed out, proceeding with shutdown",
        );
        resolve();
      }, timeoutMs);
      timer.unref();

      this.drainResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  destroy(): void {
    this.breakers.destroy();
    this.bulkheads.destroy();
    this.timeouts.destroy();
  }

  private isTimeout(err: unknown): boolean {
    return err instanceof DOMException && err.name === "AbortError";
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof CircuitOpenError) return false;
    if (this.isTimeout(err)) return false;

    if (err instanceof BankCallError && err.statusCode) {
      return this.config.retry.retryableStatusCodes.includes(err.statusCode);
    }

    if (err instanceof TypeError && err.message.includes("fetch")) return true;

    return false;
  }
}
