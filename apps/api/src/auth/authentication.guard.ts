import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { enrichLogContext } from '@cka/observability';
import { ApiError } from '../common/api-error.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { UsersService } from '../users/users.service.js';
import {
  IDENTITY_VERIFIER,
  IdentityProviderUnavailableError,
  type IdentityVerifier,
  InvalidCredentialError,
} from './identity-verifier.js';
import { IS_PUBLIC } from './public.decorator.js';
import type { ApiRequest } from './request-context.js';

const BEARER =
  /^Bearer ([A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_.+/=]*)$/;

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * Maps the verified identity to the internal User; tokens are never logged.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly logger = new Logger(AuthenticationGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(IDENTITY_VERIFIER) private readonly verifier: IdentityVerifier,
    private readonly users: UsersService,
    private readonly limits: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<ApiRequest>();
    const ip = request.ip ?? 'unknown';
    // Brute-force guard: an IP with too many failed attempts is throttled
    // before any token is examined (E8-T03).
    this.limits.assertAuthAllowed(ip);
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) {
      this.limits.recordAuthFailure(ip);
      throw ApiError.unauthenticated();
    }

    let identity;
    try {
      identity = await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof InvalidCredentialError) {
        this.limits.recordAuthFailure(ip);
        this.logger.debug(`Rejected access token: ${error.message}`);
        throw ApiError.unauthenticated();
      }
      if (error instanceof IdentityProviderUnavailableError) {
        this.logger.warn(`Identity provider unavailable: ${error.message}`);
        throw new ApiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'AUTH_PROVIDER_UNAVAILABLE',
          'Authentication is temporarily unavailable.',
        );
      }
      throw error;
    }

    request.authUser = await this.users.resolveVerifiedIdentity(identity);
    enrichLogContext({ userId: request.authUser.userId });
    return true;
  }
}
