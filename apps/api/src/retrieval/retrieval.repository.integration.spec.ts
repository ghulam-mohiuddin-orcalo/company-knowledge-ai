import type { Database } from '@cka/database';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { DATABASE } from '../database/database.module.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { TenantScope } from '../tenancy/tenant-scope.js';
import { axisVector, seedIndexedDocument } from '../testing/chunk-fixtures.js';
import { createTestConfig } from '../testing/test-config.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import { UsersService } from '../users/users.service.js';
import { RetrievalRepository } from './retrieval.repository.js';

describe('tenant-scoped vector retrieval (E4-T01)', () => {
  let testDb: TestDatabase;
  let moduleRef: TestingModule;
  let repository: RetrievalRepository;
  let scopeA: TenantScope;
  let scopeB: TenantScope;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    testDb = await createTestDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot(createTestConfig({ DATABASE_URL: testDb.url })),
      ],
    }).compile();
    repository = moduleRef.get(RetrievalRepository);
    const db = moduleRef.get<Database>(DATABASE);
    const organizations = moduleRef.get(OrganizationsService);
    const { userId } = await moduleRef
      .get(UsersService)
      .resolveVerifiedIdentity({
        subject: 'retrieval-uploader',
        email: 'r@example.test',
        displayName: undefined,
      });
    const orgA = await organizations.createOrganization('Retrieval A');
    const orgB = await organizations.createOrganization('Retrieval B');
    scopeA = TenantScope.forSystem(orgA.id);
    scopeB = TenantScope.forSystem(orgB.id);
    const tenantA = { organizationId: orgA.id, uploadedBy: userId };

    const handbook = await seedIndexedDocument(db, tenantA, {
      filename: 'Handbook.pdf',
      chunks: [
        {
          content: 'Annual leave is 25 days.',
          embedding: axisVector(0),
          pageNumber: 4,
        },
        {
          content: 'Leave carries over.',
          embedding: axisVector(0, 0.5),
          pageNumber: 5,
        },
        { content: 'Unrelated parking rules.', embedding: axisVector(7) },
      ],
    });
    ids.best = handbook.chunkIds[0]!;
    ids.second = handbook.chunkIds[1]!;
    ids.parking = handbook.chunkIds[2]!;
    for (const status of [
      'QUEUED',
      'PROCESSING',
      'FAILED',
      'DELETING',
      'DELETED',
    ] as const) {
      const doc = await seedIndexedDocument(db, tenantA, {
        filename: `${status}.txt`,
        status,
        chunks: [
          { content: `${status} leave content`, embedding: axisVector(0) },
        ],
      });
      ids[status] = doc.chunkIds[0]!;
    }
    // Org B holds an identical chunk with the identical vector.
    const foreign = await seedIndexedDocument(
      db,
      { organizationId: orgB.id, uploadedBy: userId },
      {
        filename: 'Org B Handbook.pdf',
        chunks: [
          { content: 'Annual leave is 25 days.', embedding: axisVector(0) },
        ],
      },
    );
    ids.foreign = foreign.chunkIds[0]!;
  });

  afterAll(async () => {
    await moduleRef?.close();
    await testDb?.drop();
  });

  it('returns the tenant’s READY chunks ordered by similarity, with metadata', async () => {
    const matches = await repository.searchSimilarChunks(
      scopeA,
      axisVector(0),
      10,
    );

    expect(matches.map((m) => m.chunkId)).toEqual([
      ids.best,
      ids.second,
      ids.parking,
    ]);
    expect(matches[0]).toMatchObject({
      documentName: 'Handbook.pdf',
      content: 'Annual leave is 25 days.',
      pageNumber: 4,
      chunkIndex: 0,
      charStart: 0,
      charEnd: 24,
    });
    expect(matches[0]!.score).toBeCloseTo(1, 6);
    expect(matches[1]!.score).toBeLessThan(matches[0]!.score);
    expect(matches[2]!.score).toBeCloseTo(0, 6);
  });

  it('never returns another tenant’s chunks, even with identical content and vector', async () => {
    const matches = await repository.searchSimilarChunks(
      scopeA,
      axisVector(0),
      100,
    );

    expect(matches.map((m) => m.chunkId)).not.toContain(ids.foreign);
    expect(matches.every((m) => m.documentName !== 'Org B Handbook.pdf')).toBe(
      true,
    );
  });

  it('excludes chunks of documents that are not READY', async () => {
    const matches = await repository.searchSimilarChunks(
      scopeA,
      axisVector(0),
      100,
    );
    const returned = matches.map((m) => m.chunkId);

    for (const status of [
      'QUEUED',
      'PROCESSING',
      'FAILED',
      'DELETING',
      'DELETED',
    ]) {
      expect(returned).not.toContain(ids[status]);
    }
  });

  it('respects the limit', async () => {
    expect(
      await repository.searchSimilarChunks(scopeA, axisVector(0), 1),
    ).toHaveLength(1);
  });

  it('isolates the other tenant symmetrically', async () => {
    const matches = await repository.searchSimilarChunks(
      scopeB,
      axisVector(0),
      100,
    );

    expect(matches.map((m) => m.chunkId)).toEqual([ids.foreign]);
  });
});
