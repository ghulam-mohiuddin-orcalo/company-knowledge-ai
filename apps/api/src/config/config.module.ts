import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { AppConfig, AuthConfig } from '@cka/config';
export const APP_CONFIG = Symbol('APP_CONFIG');
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export interface ApiConfig {
  config: AppConfig;
  auth: AuthConfig;
}

/** Exposes the configuration validated at startup to the whole application. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot({ config, auth }: ApiConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: AUTH_CONFIG, useValue: auth },
      ],
      exports: [APP_CONFIG, AUTH_CONFIG],
    };
  }
}
