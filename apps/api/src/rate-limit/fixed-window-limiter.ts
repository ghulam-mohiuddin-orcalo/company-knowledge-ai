interface Window {
  count: number;
  resetAt: number;
}

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfterSeconds: number;
}

/**
 * In-memory fixed-window counter. Per API instance: with several instances the
 * effective limit scales with the instance count (a shared store can replace
 * this without changing callers).
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts a hit; disallowed once the count exceeds `limit` in the window. */
  hit(key: string, limit: number): LimitResult {
    const window = this.current(key);
    window.count++;
    return this.result(window, limit);
  }

  /** Checks without counting (e.g. before verifying credentials). */
  check(key: string, limit: number): LimitResult {
    return this.result(this.current(key), limit, true);
  }

  private current(key: string): Window {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      if (this.windows.size > 10_000) this.prune(now);
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    return window;
  }

  private result(window: Window, limit: number, peek = false): LimitResult {
    return {
      allowed: peek ? window.count < limit : window.count <= limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((window.resetAt - this.now()) / 1000),
      ),
    };
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
