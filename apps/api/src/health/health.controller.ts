import {
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type DatabasePool,
  describeDatabaseError,
  pingDatabase,
} from '@cka/database';
import { DATABASE_POOL } from '../database/database.module.js';

const READINESS_TIMEOUT_MS = 2000;

type CheckStatus = 'up' | 'down';

export interface ReadinessResponse {
  status: 'ok' | 'unavailable';
  checks: { database: CheckStatus };
}

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: DatabasePool) {}

  /** Liveness: the process is serving HTTP. Never depends on the database or AI providers. */
  @Get('health')
  @Header('Cache-Control', 'no-store')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies required to serve traffic are reachable (PostgreSQL). */
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(): Promise<ReadinessResponse> {
    try {
      await pingDatabase(this.pool, READINESS_TIMEOUT_MS);
      return { status: 'ok', checks: { database: 'up' } };
    } catch (error) {
      // Details go to logs only; the response never exposes internal errors.
      this.logger.warn(
        `Readiness check failed: database ${describeDatabaseError(error)}`,
      );
      throw new ServiceUnavailableException({
        status: 'unavailable',
        checks: { database: 'down' },
      } satisfies ReadinessResponse);
    }
  }
}
