import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Authorize } from '../authorization/authorize.decorator.js';
import { ApiError } from '../common/api-error.js';
import { CurrentPrincipal, type Principal } from '../tenancy/principal.js';
import { TenantScope } from '../tenancy/tenant-scope.js';
import type { DocumentView } from './documents.repository.js';
import { parsePageRequest } from '../common/pagination.js';
import {
  DocumentsService,
  type UploadedFile as UploadedDocumentFile,
} from './documents.service.js';

export interface DocumentResponse {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentView['status'];
  errorCode: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export function toDocumentResponse(document: DocumentView): DocumentResponse {
  return {
    id: document.id,
    filename: document.filename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    errorCode: document.errorCode,
    uploadedBy: document.uploadedBy,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export interface DocumentListResponse {
  items: DocumentResponse[];
  nextCursor: string | null;
}

@Controller('v1/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @Authorize('MEMBER')
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: Record<string, unknown>,
  ): Promise<DocumentListResponse> {
    const page = await this.documents.list(
      TenantScope.fromPrincipal(principal),
      parsePageRequest(query),
    );
    return {
      items: page.items.map(toDocumentResponse),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':documentId')
  @Authorize('MEMBER')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<DocumentResponse> {
    return toDocumentResponse(
      await this.documents.get(
        TenantScope.fromPrincipal(principal),
        documentId,
      ),
    );
  }

  /** Multipart upload (field `file`). Authorization runs before the body is read. */
  @Post()
  @Authorize('ORG_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentPrincipal() principal: Principal,
    @UploadedFile() file: UploadedDocumentFile | undefined,
  ): Promise<DocumentResponse> {
    if (!file) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'A file is required in the "file" field.',
      );
    }
    const document = await this.documents.upload(
      TenantScope.fromPrincipal(principal),
      principal.userId,
      file,
    );
    return toDocumentResponse(document);
  }

  /** 204 for the first and every repeated delete; 404 for foreign/unknown IDs. */
  @Delete(':documentId')
  @Authorize('ORG_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentPrincipal() principal: Principal,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<void> {
    await this.documents.delete(
      TenantScope.fromPrincipal(principal),
      documentId,
    );
  }
}
