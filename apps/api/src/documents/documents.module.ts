import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import type { AppConfig } from '@cka/config';
import { memoryStorage } from 'multer';
import { APP_CONFIG } from '../config/config.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsRepository } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        storage: memoryStorage(),
        // Size is enforced while streaming; oversized uploads are rejected with 413.
        limits: {
          fileSize: config.uploads.maxBytes,
          files: 1,
          fields: 0,
          parts: 1,
        },
        defParamCharset: 'utf8',
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsRepository, DocumentsService],
})
export class DocumentsModule {}
