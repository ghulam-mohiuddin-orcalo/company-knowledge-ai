import { SetMetadata } from '@nestjs/common';
import type { RateLimitedOperation } from './rate-limit.service.js';

export const SKIP_RATE_LIMIT = 'rateLimit:skip';
export const RATE_LIMITED_OPERATION = 'rateLimit:operation';

/** Excludes a route from the per-IP request limit (e.g. health probes). */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT, true);

/** Applies a per-user limit to a costly operation (checked after authorization). */
export const RateLimit = (operation: RateLimitedOperation): MethodDecorator =>
  SetMetadata(RATE_LIMITED_OPERATION, operation);
