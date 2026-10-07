import { Module } from '@nestjs/common';
import type { AuthConfig } from '@cka/config';
import { AUTH_CONFIG } from '../config/config.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { IDENTITY_VERIFIER } from './identity-verifier.js';
import { OidcJwtIdentityVerifier } from './oidc-jwt-identity-verifier.js';

@Module({
  imports: [UsersModule],
  providers: [
    {
      provide: IDENTITY_VERIFIER,
      inject: [AUTH_CONFIG],
      useFactory: (config: AuthConfig) => new OidcJwtIdentityVerifier(config),
    },
    AuthenticationGuard,
  ],
  exports: [AuthenticationGuard],
})
export class AuthModule {}
