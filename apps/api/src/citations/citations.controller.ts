import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import { ObjectNotFoundError, type ObjectStorage } from '@cka/storage';
import type { Response } from 'express';
import { Authorize } from '../authorization/authorize.decorator.js';
import { ApiError } from '../common/api-error.js';
import { OBJECT_STORAGE } from '../storage/storage.module.js';
import { CurrentPrincipal, type Principal } from '../tenancy/principal.js';
import { TenantScope } from '../tenancy/tenant-scope.js';
import {
  type CitationSource,
  CitationsRepository,
} from './citations.repository.js';
import type { CitationSourceResponse } from '@cka/contracts';
export type { CitationSourceResponse };

const unavailable = () =>
  new ApiError(
    HttpStatus.GONE,
    'SOURCE_UNAVAILABLE',
    'This source is no longer available.',
  );

/**
 * Citation source resolution (E6-T04, TDD §17 step 7). Every request re-checks
 * tenant scope, conversation ownership and that the document is still READY;
 * originals are streamed from private storage through the API.
 */
@Controller('v1/citations')
export class CitationsController {
  constructor(
    private readonly citations: CitationsRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Get(':citationId/source')
  @Authorize('MEMBER')
  async source(
    @CurrentPrincipal() principal: Principal,
    @Param('citationId', new ParseUUIDPipe()) citationId: string,
  ): Promise<CitationSourceResponse> {
    const citation = await this.authorize(principal, citationId);
    return {
      citationId: citation.id,
      ordinal: citation.ordinal,
      document: {
        id: citation.documentId,
        name: citation.documentName,
        mimeType: citation.mimeType,
      },
      locator: {
        page: citation.locator.page,
        section: citation.locator.section,
      },
      text: citation.chunkContent!,
      originalUrl: `/v1/citations/${citation.id}/source/original`,
    };
  }

  @Get(':citationId/source/original')
  @Authorize('MEMBER')
  async original(
    @CurrentPrincipal() principal: Principal,
    @Param('citationId', new ParseUUIDPipe()) citationId: string,
    @Res() response: Response,
  ): Promise<void> {
    const citation = await this.authorize(principal, citationId);
    let body: Buffer;
    try {
      body = await this.storage.getObject(citation.storageKey);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) throw unavailable();
      throw error;
    }
    response
      .status(HttpStatus.OK)
      .set({
        'Content-Type': citation.mimeType,
        'Content-Length': String(body.length),
        // Always a download: uploaded content is never rendered by the browser.
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(citation.documentName)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      })
      .end(body);
  }

  /** Foreign or unknown citations: 404; own citation whose source is gone: 410. */
  private async authorize(
    principal: Principal,
    citationId: string,
  ): Promise<CitationSource> {
    const citation = await this.citations.findOwnedById(
      TenantScope.fromPrincipal(principal),
      principal.userId,
      citationId,
    );
    if (!citation) throw ApiError.notFound();
    if (!citation.available) throw unavailable();
    return citation;
  }
}
