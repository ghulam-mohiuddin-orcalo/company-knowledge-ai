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
import { EMBEDDING_PROVIDER, RetrievalService } from './retrieval.service.js';

describe('RetrievalService (E4-T02)', () => {
  let testDb: TestDatabase;
  let moduleRef: TestingModule;
  let service: RetrievalService;
  let scopeA: TenantScope;
  const embedQuery = vi.fn(async () => axisVector(0));
  let leaveDoc: { documentId: string; chunkIds: string[] };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot(
          createTestConfig({
            DATABASE_URL: testDb.url,
            RETRIEVAL_MAX_EVIDENCE: '3',
            RETRIEVAL_MAX_PER_DOCUMENT: '2',
          }),
        ),
      ],
    })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({
        model: 'test',
        dimensions: 1536,
        embedQuery,
        embedTexts: vi.fn(),
      })
      .compile();
    service = moduleRef.get(RetrievalService);
    const db = moduleRef.get<Database>(DATABASE);
    const organizations = moduleRef.get(OrganizationsService);
    const { userId } = await moduleRef
      .get(UsersService)
      .resolveVerifiedIdentity({
        subject: 'svc-uploader',
        email: 's@example.test',
        displayName: undefined,
      });
    const orgA = await organizations.createOrganization('Service A');
    const orgB = await organizations.createOrganization('Service B');
    scopeA = TenantScope.forSystem(orgA.id);

    // "Leave is 25 days. Carry over 5 days." split into two overlapping chunks.
    leaveDoc = await seedIndexedDocument(
      db,
      { organizationId: orgA.id, uploadedBy: userId },
      {
        filename: 'Leave.pdf',
        chunks: [
          {
            content: 'Leave is 25 days. Carry',
            embedding: axisVector(0),
            pageNumber: 2,
            charStart: 0,
          },
          {
            content: 'Carry over 5 days.',
            embedding: axisVector(0, 0.2),
            pageNumber: 2,
            charStart: 18,
          },
          {
            content: 'Sick leave policy.',
            embedding: axisVector(0, 0.4),
            pageNumber: 3,
          },
          {
            content: 'Parental leave policy.',
            embedding: axisVector(0, 0.5),
            pageNumber: 4,
          },
        ],
      },
    );
    await seedIndexedDocument(
      db,
      { organizationId: orgA.id, uploadedBy: userId },
      {
        filename: 'Other.txt',
        chunks: [
          { content: 'Holiday calendar.', embedding: axisVector(0, 0.9) },
        ],
      },
    );
    await seedIndexedDocument(
      db,
      { organizationId: orgB.id, uploadedBy: userId },
      {
        filename: 'OrgB.txt',
        chunks: [
          { content: 'Org B leave is 40 days.', embedding: axisVector(0) },
        ],
      },
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
    await testDb?.drop();
  });

  it('returns bounded, merged, tenant-scoped evidence for a question', async () => {
    const hits = await service.retrieve(scopeA, '  How much   leave?\n');

    expect(embedQuery).toHaveBeenCalledWith('How much leave?');
    expect(hits[0]).toEqual({
      chunkIds: leaveDoc.chunkIds.slice(0, 2),
      documentId: leaveDoc.documentId,
      documentName: 'Leave.pdf',
      content: 'Leave is 25 days. Carry over 5 days.',
      score: expect.closeTo(1, 6),
      locator: { page: 2, section: null, charStart: 0, charEnd: 36 },
    });
    expect(hits).toHaveLength(3);
    expect(
      hits.filter((h) => h.documentId === leaveDoc.documentId),
    ).toHaveLength(2);
    expect(hits.map((h) => h.content).join(' ')).not.toContain('Org B');
  });

  it('skips the provider for an empty question', async () => {
    embedQuery.mockClear();

    expect(await service.retrieve(scopeA, ' \n\t ')).toEqual([]);
    expect(embedQuery).not.toHaveBeenCalled();
  });
});
