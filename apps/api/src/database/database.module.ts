import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import {
  createDatabasePool,
  type DatabasePool,
  describeDatabaseError,
} from '@cka/database';
import { APP_CONFIG } from '../config/config.module.js';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DatabasePool => {
        const logger = new Logger('Database');
        return createDatabasePool(config.database.url.reveal(), (error) =>
          logger.warn(`Idle connection error ${describeDatabaseError(error)}`),
        );
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: DatabasePool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
