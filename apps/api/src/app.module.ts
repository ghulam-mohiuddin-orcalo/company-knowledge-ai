import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthenticationGuard } from './auth/authentication.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthorizationGuard } from './authorization/authorization.guard.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';
import { type ApiConfig, ConfigModule } from './config/config.module.js';
import { CitationsModule } from './citations/citations.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { HealthModule } from './health/health.module.js';
import { MeModule } from './me/me.module.js';
import { RagModule } from './rag/rag.module.js';
import { RetrievalModule } from './retrieval/retrieval.module.js';
import { StorageModule } from './storage/storage.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

// Feature modules (documents, conversations, ...) are registered here by their tickets.
@Module({})
export class AppModule {
  static forRoot(apiConfig: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(apiConfig),
        DatabaseModule,
        StorageModule,
        AuthModule,
        OrganizationsModule,
        TenancyModule,
        AuthorizationModule,
        HealthModule,
        MeModule,
        DocumentsModule,
        RetrievalModule,
        ConversationsModule,
        RagModule,
        CitationsModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
        // Global guards run in this order: authenticate, then authorize (incl. tenant).
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
        { provide: APP_GUARD, useExisting: AuthorizationGuard },
      ],
    };
  }
}
