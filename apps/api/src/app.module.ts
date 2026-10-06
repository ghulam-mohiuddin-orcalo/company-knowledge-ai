import { type DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

// Feature modules (auth, tenancy, documents, ...) are registered here by their tickets.
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), DatabaseModule, HealthModule],
    };
  }
}
