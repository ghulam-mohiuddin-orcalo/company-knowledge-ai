import { Global, Module } from '@nestjs/common';
import { ApiMetrics } from './api-metrics.js';
import { MetricsController } from './metrics.controller.js';
import { OperationalMetricsRepository } from './operational-metrics.repository.js';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [ApiMetrics, OperationalMetricsRepository],
  exports: [ApiMetrics],
})
export class MetricsModule {}
