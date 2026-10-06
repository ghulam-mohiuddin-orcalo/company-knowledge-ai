import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { AppConfig } from '@cka/config';

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Exposes the configuration validated at startup to the whole application. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
