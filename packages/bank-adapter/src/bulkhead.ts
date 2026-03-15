export interface BulkheadConfig {
  maxConcurrent: number;
  maxQueueSize: number;
  queueTimeoutMs: number;
}

export class BulkheadFullError extends Error {
  constructor(bankOrgId: string) {
    super(`Bulkhead full for bank ${bankOrgId}`);
    this.name = "BulkheadFullError";
  }
}

interface WaiterNode {
  id: number;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  prev: WaiterNode | null;
  next: WaiterNode | null;
}

export class Bulkhead {
  private active = 0;
  private queueSize = 0;
  private queueHead: WaiterNode | null = null;
  private queueTail: WaiterNode | null = null;
  private nextId = 0;
  private lastUsedAt = Date.now();

  constructor(
    private readonly bankOrgId: string,
    private readonly config: BulkheadConfig,
  ) {}

  getLastUsedAt(): number {
    return this.lastUsedAt;
  }

  acquire(): Promise<() => void> {
    this.lastUsedAt = Date.now();

    if (this.active < this.config.maxConcurrent) {
      this.active++;
      return Promise.resolve(this.createReleaseHandle());
    }

    if (this.queueSize >= this.config.maxQueueSize) {
      return Promise.reject(new BulkheadFullError(this.bankOrgId));
    }

    return new Promise<() => void>((resolve, reject) => {
      const node: WaiterNode = {
        id: this.nextId++,
        resolve,
        reject,
        settled: false,
        timer: setTimeout(() => {
          if (node.settled) return;
          node.settled = true;
          this.removeNode(node);
          reject(new BulkheadFullError(this.bankOrgId));
        }, this.config.queueTimeoutMs),
        prev: null,
        next: null,
      };

      this.appendNode(node);
    });
  }

  stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.queueSize };
  }

  private createReleaseHandle(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    this.active--;

    while (this.queueHead) {
      const node = this.queueHead;
      this.removeNode(node);

      if (node.settled) continue;

      node.settled = true;
      clearTimeout(node.timer);
      this.active++;
      node.resolve(this.createReleaseHandle());
      return;
    }
  }

  private appendNode(node: WaiterNode): void {
    node.prev = this.queueTail;
    node.next = null;
    if (this.queueTail) {
      this.queueTail.next = node;
    } else {
      this.queueHead = node;
    }
    this.queueTail = node;
    this.queueSize++;
  }

  private removeNode(node: WaiterNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.queueHead = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.queueTail = node.prev;
    }
    node.prev = null;
    node.next = null;
    this.queueSize--;
  }
}

export class BulkheadRegistry {
  private readonly bulkheads = new Map<string, Bulkhead>();
  private readonly evictionIntervalMs: number;
  private readonly maxIdleMs: number;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: BulkheadConfig,
    evictionIntervalMs = 60_000,
    maxIdleMs = 300_000,
  ) {
    this.evictionIntervalMs = evictionIntervalMs;
    this.maxIdleMs = maxIdleMs;
    this.evictionTimer = setInterval(() => this.evict(), this.evictionIntervalMs);
    this.evictionTimer.unref();
  }

  getBulkhead(bankOrgId: string): Bulkhead {
    let bulkhead = this.bulkheads.get(bankOrgId);
    if (!bulkhead) {
      bulkhead = new Bulkhead(bankOrgId, this.config);
      this.bulkheads.set(bankOrgId, bulkhead);
    }
    return bulkhead;
  }

  destroy(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  private evict(): void {
    const now = Date.now();
    for (const [id, bulkhead] of this.bulkheads) {
      if (now - bulkhead.getLastUsedAt() > this.maxIdleMs && bulkhead.stats().active === 0) {
        this.bulkheads.delete(id);
      }
    }
  }
}
