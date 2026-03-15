export interface AdaptiveTimeoutConfig {
  windowMs: number;
  minTimeoutMs: number;
  maxTimeoutMs: number;
  defaultTimeoutMs: number;
  percentile: number;
  multiplier: number;
  minSamples: number;
}

interface Sample {
  durationMs: number;
  timestamp: number;
}

function quickselect(arr: number[], k: number): number {
  let lo = 0;
  let hi = arr.length - 1;

  while (lo < hi) {
    const pivot = arr[(lo + hi) >> 1]!;
    let i = lo;
    let j = hi;

    while (i <= j) {
      while (arr[i]! < pivot) i++;
      while (arr[j]! > pivot) j--;
      if (i <= j) {
        const tmp = arr[i]!;
        arr[i] = arr[j]!;
        arr[j] = tmp;
        i++;
        j--;
      }
    }

    if (j < k) lo = i;
    if (i > k) hi = j;
  }

  return arr[k]!;
}

export class AdaptiveTimeout {
  private readonly buffer: Sample[];
  private head = 0;
  private count = 0;
  private readonly capacity: number;
  private lastUsedAt = Date.now();

  constructor(private readonly config: AdaptiveTimeoutConfig) {
    this.capacity = Math.ceil((config.windowMs / 1000) * 100);
    this.buffer = new Array<Sample>(this.capacity);
  }

  getLastUsedAt(): number {
    return this.lastUsedAt;
  }

  record(durationMs: number): void {
    this.lastUsedAt = Date.now();
    const sample: Sample = { durationMs, timestamp: Date.now() };
    const idx = (this.head + this.count) % this.capacity;
    this.buffer[idx] = sample;

    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  getTimeoutMs(): number {
    this.lastUsedAt = Date.now();
    this.prune();

    if (this.count < this.config.minSamples) {
      return this.config.defaultTimeoutMs;
    }

    const durations = new Array<number>(this.count);
    for (let i = 0; i < this.count; i++) {
      durations[i] = this.buffer[(this.head + i) % this.capacity]!.durationMs;
    }

    const k = Math.min(
      Math.floor(this.count * this.config.percentile),
      this.count - 1,
    );
    const pValue = quickselect(durations, k);
    const timeout = Math.round(pValue * this.config.multiplier);

    return Math.max(this.config.minTimeoutMs, Math.min(timeout, this.config.maxTimeoutMs));
  }

  private prune(): void {
    const cutoff = Date.now() - this.config.windowMs;
    while (this.count > 0) {
      const sample = this.buffer[this.head]!;
      if (sample.timestamp < cutoff) {
        this.head = (this.head + 1) % this.capacity;
        this.count--;
      } else {
        break;
      }
    }
  }
}

export class AdaptiveTimeoutRegistry {
  private readonly timeouts = new Map<string, AdaptiveTimeout>();
  private readonly evictionIntervalMs: number;
  private readonly maxIdleMs: number;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: AdaptiveTimeoutConfig,
    evictionIntervalMs = 60_000,
    maxIdleMs = 300_000,
  ) {
    this.evictionIntervalMs = evictionIntervalMs;
    this.maxIdleMs = maxIdleMs;
    this.evictionTimer = setInterval(() => this.evict(), this.evictionIntervalMs);
    this.evictionTimer.unref();
  }

  getTimeout(bankOrgId: string): AdaptiveTimeout {
    let timeout = this.timeouts.get(bankOrgId);
    if (!timeout) {
      timeout = new AdaptiveTimeout(this.config);
      this.timeouts.set(bankOrgId, timeout);
    }
    return timeout;
  }

  destroy(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  private evict(): void {
    const now = Date.now();
    for (const [id, timeout] of this.timeouts) {
      if (now - timeout.getLastUsedAt() > this.maxIdleMs) {
        this.timeouts.delete(id);
      }
    }
  }
}
