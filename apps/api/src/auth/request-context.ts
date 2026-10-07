import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/api-error.js';

/** The internal user behind a verified access token. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string | null;
  /** From the internal user record only; never from provider claims. */
  isPlatformAdmin: boolean;
}

/** Request fields set by the server-side guards; never read from client input. */
export interface ApiRequest extends Request {
  authUser?: AuthenticatedUser;
}

/** Injects the authenticated internal user (set by AuthenticationGuard). */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<ApiRequest>().authUser;
    if (!user) throw ApiError.unauthenticated();
    return user;
  },
);
