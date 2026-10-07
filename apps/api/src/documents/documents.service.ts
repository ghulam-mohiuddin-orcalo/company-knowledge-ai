import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { AppConfig } from '@cka/config';
import { documentObjectKey, type ObjectStorage } from '@cka/storage';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import { OBJECT_STORAGE } from '../storage/storage.module.js';
import type { TenantScope } from '../tenancy/tenant-scope.js';
import {
  type DocumentView,
  DocumentsRepository,
} from './documents.repository.js';
import { encodeCursor, type PageRequest } from '../common/pagination.js';
import {
  assertNotEmpty,
  resolveDocumentType,
  sanitizeFilename,
} from './upload-validation.js';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly documents: DocumentsRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Validates the file, stores it privately under a server-generated key, then
   * persists the document with a queued ingestion job.
   */
  async upload(
    scope: TenantScope,
    uploadedBy: string,
    file: UploadedFile,
  ): Promise<DocumentView> {
    const filename = sanitizeFilename(file.originalname);
    if (filename === '') {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The file name is invalid.',
      );
    }
    assertNotEmpty(file.size);
    const mimeType = resolveDocumentType(
      filename,
      file.mimetype,
      file.buffer,
      this.config.uploads.allowedMimeTypes,
    );

    const id = randomUUID();
    const storageKey = documentObjectKey(scope.organizationId, id);
    await this.storage.putObject(storageKey, file.buffer, {
      contentType: mimeType,
    });
    try {
      return await this.documents.createWithIngestionJob(scope, {
        id,
        uploadedBy,
        filename,
        storageKey,
        mimeType,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      });
    } catch (error) {
      // Do not leave an orphaned object behind when metadata cannot be saved.
      await this.storage.deleteObject(storageKey).catch(() => {
        this.logger.warn(`Could not remove orphaned object for document ${id}`);
      });
      throw error;
    }
  }

  /** Active documents of the tenant, newest first. */
  async list(
    scope: TenantScope,
    page: PageRequest,
  ): Promise<{ items: DocumentView[]; nextCursor: string | null }> {
    const rows = await this.documents.listActive(scope, {
      limit: page.limit + 1,
      after: page.after,
    });
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > page.limit && last ? encodeCursor(last) : null,
    };
  }

  /** Foreign-tenant, unknown and deleted documents are indistinguishable (404). */
  async get(scope: TenantScope, documentId: string): Promise<DocumentView> {
    const document = await this.documents.findActiveById(scope, documentId);
    if (!document) throw ApiError.notFound();
    return document;
  }

  /**
   * Marks the document DELETING (immediately non-retrievable); the worker removes
   * chunks and the stored object asynchronously. Repeating the call is a no-op.
   */
  async delete(
    scope: TenantScope,
    documentId: string,
    actorUserId: string,
  ): Promise<void> {
    if (await this.documents.markDeletingById(scope, documentId, actorUserId)) {
      return;
    }
    if (!(await this.documents.existsById(scope, documentId))) {
      throw ApiError.notFound();
    }
  }
}
