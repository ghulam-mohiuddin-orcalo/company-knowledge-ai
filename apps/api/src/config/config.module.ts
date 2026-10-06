import { type DynamicModule, Global, Module } from '@nestjs/common';
import type {
  AppConfig,
  AuthConfig,
  EmbeddingConfig,
  GenerationConfig,
} from '@cka/config';
export const APP_CONFIG = Symbol('APP_CONFIG');
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
export const EMBEDDING_CONFIG = Symbol('EMBEDDING_CONFIG');
export const GENERATION_CONFIG = Symbol('GENERATION_CONFIG');

export interface ApiConfig {
  config: AppConfig;
  auth: AuthConfig;
  embedding: EmbeddingConfig;
  generation: GenerationConfig;
}

/** Exposes the configuration validated at startup to the whole application. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot({
    config,
    auth,
    embedding,
    generation,
  }: ApiConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: AUTH_CONFIG, useValue: auth },
        { provide: EMBEDDING_CONFIG, useValue: embedding },
        { provide: GENERATION_CONFIG, useValue: generation },
      ],
      exports: [APP_CONFIG, AUTH_CONFIG, EMBEDDING_CONFIG, GENERATION_CONFIG],
    };
  }
}
