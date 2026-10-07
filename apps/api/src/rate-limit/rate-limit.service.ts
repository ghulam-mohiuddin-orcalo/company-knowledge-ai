import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import { FixedWindowLimiter } from './fixed-window-limiter.js';

export type RateLimitedOperation = 'ask' | 'upload';

/** Abuse controls (E8-T03): per-IP requests and auth failures, per-user operations. */
@Injectable()
export class RateLimitService {
  private readonly requests: FixedWindowLimiter;
  private readonly authFailures: FixedWindowLimiter;
  private readonly operations: FixedWindowLimiter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const { windowMs } = config.rateLimits;
    this.requests = new FixedWindowLimiter(windowMs);
    this.authFailures = new FixedWindowLimiter(windowMs);
    this.operations = new FixedWindowLimiter(windowMs);
  }

  consumeRequest(ip: string): void {
    this.enforce(
      this.requests.hit(`ip:${ip}`, this.config.rateLimits.requestsPerIp),
    );
  }

  /** Refuses further authentication attempts from an IP with too many failures. */
  assertAuthAllowed(ip: string): void {
    this.enforce(
      this.authFailures.check(
        `auth:${ip}`,
        this.config.rateLimits.authFailuresPerIp,
      ),
    );
  }

  recordAuthFailure(ip: string): void {
    this.authFailures.hit(
      `auth:${ip}`,
      this.config.rateLimits.authFailuresPerIp,
    );
  }

  consumeOperation(operation: RateLimitedOperation, userId: string): void {
    const limit =
      operation === 'ask'
        ? this.config.rateLimits.asksPerUser
        : this.config.rateLimits.uploadsPerUser;
    this.enforce(this.operations.hit(`${operation}:${userId}`, limit));
  }

  private enforce(result: {
    allowed: boolean;
    retryAfterSeconds: number;
  }): void {
    if (result.allowed) return;
    throw new ApiError(
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMITED',
      'Too many requests. Please wait and try again.',
      result.retryAfterSeconds,
    );
  }
}
