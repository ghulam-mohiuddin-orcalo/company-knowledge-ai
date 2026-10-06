import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import { type ObjectStorage, S3ObjectStorage } from '@cka/storage';
import { APP_CONFIG } from '../config/config.module.js';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ObjectStorage =>
        new S3ObjectStorage(config.storage),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule implements OnApplicationShutdown {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onApplicationShutdown(): void {
    if (this.storage instanceof S3ObjectStorage) this.storage.destroy();
  }
}
