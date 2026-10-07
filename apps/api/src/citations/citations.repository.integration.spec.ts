import { randomUUID } from 'node:crypto';
import {
  answerCitations,
  type Database,
  documentChunks,
  documents,
} from '@cka/database';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { ConversationsRepository } from '../conversations/conversations.repository.js';
import { ConversationsService } from '../conversations/conversations.service.js';
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
import {
  CitationsRepository,
  CitedEvidenceUnavailableError,
  type NewCitation,
} from './citations.repository.js';

describe('citation persistence (E6-T01)', () => {
  let testDb: TestDatabase;
  let moduleRef: TestingModule;
  let db: Database;
  let citations: CitationsRepository;
  let conversations: ConversationsRepository;
  let scopeA: TenantScope;
  let userId: string;
  let docA: { documentId: string; chunkIds: string[] };
  let docB: { documentId: string; chunkIds: string[] };

  const citation = (overrides: Partial<NewCitation> = {}): NewCitation => ({
    ordinal: 1,
    sourceLabel: 'SOURCE_1',
    documentId: docA.documentId,
    chunkId: docA.chunkIds[0]!,
    locator: { page: 2, section: null, charStart: 0, charEnd: 10 },
    ...overrides,
  });

  /** Stores an answer with the given citations; returns the message ID. */
  const answerWith = async (list: NewCitation[]) => {
    const conversation = await moduleRef
      .get(ConversationsService)
      .create(scopeA, userId, undefined);
    const { message } = await conversations.insertUserMessage(
      scopeA,
      conversation.id,
      'question',
      null,
    );
    const reply = await conversations.insertAssistantReply(
      scopeA,
      conversation.id,
      {
        replyToMessageId: message.id,
        content: 'answer [1]',
        outcome: 'ANSWERED',
        model: 'm',
        latencyMs: 1,
        inputTokens: null,
        outputTokens: null,
      },
      (tx, messageId) =>
        citations.insertForMessage(tx, scopeA, messageId, list),
    );
    return { messageId: reply.id, conversationId: conversation.id };
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot(createTestConfig({ DATABASE_URL: testDb.url })),
      ],
    }).compile();
    db = moduleRef.get(DATABASE);
    citations = moduleRef.get(CitationsRepository);
    conversations = moduleRef.get(ConversationsRepository);
    ({ userId } = await moduleRef.get(UsersService).resolveVerifiedIdentity({
      subject: 'cit-user',
      email: 'c@example.test',
      displayName: undefined,
    }));
    const organizations = moduleRef.get(OrganizationsService);
    const orgA = await organizations.createOrganization('Citations A');
    const orgB = await organizations.createOrganization('Citations B');
    scopeA = TenantScope.forSystem(orgA.id);
    docA = await seedIndexedDocument(
      db,
      { organizationId: orgA.id, uploadedBy: userId },
      {
        filename: 'A.pdf',
        chunks: [
          { content: 'Evidence A1', embedding: axisVector(0), pageNumber: 2 },
          { content: 'Evidence A2', embedding: axisVector(1), pageNumber: 3 },
        ],
      },
    );
    docB = await seedIndexedDocument(
      db,
      { organizationId: orgB.id, uploadedBy: userId },
      {
        filename: 'B.pdf',
        chunks: [{ content: 'Evidence B', embedding: axisVector(0) }],
      },
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
    await testDb?.drop();
  });

  it('creates citations from server-known chunks of READY tenant documents', async () => {
    const { messageId } = await answerWith([
      citation(),
      citation({
        ordinal: 2,
        sourceLabel: 'SOURCE_2',
        chunkId: docA.chunkIds[1]!,
      }),
    ]);

    const views = await citations.listForMessages(scopeA, [messageId]);
    expect(views).toEqual([
      expect.objectContaining({
        ordinal: 1,
        documentName: 'A.pdf',
        chunkContent: 'Evidence A1',
        available: true,
      }),
      expect.objectContaining({
        ordinal: 2,
        chunkContent: 'Evidence A2',
        available: true,
      }),
    ]);
  });

  it.each([
    [
      'another tenant’s chunk and document',
      () =>
        citation({ documentId: docB.documentId, chunkId: docB.chunkIds[0]! }),
    ],
    [
      'another tenant’s chunk under an own document',
      () => citation({ chunkId: docB.chunkIds[0]! }),
    ],
    ['an unknown chunk', () => citation({ chunkId: randomUUID() })],
    [
      'an own chunk under a different document ID',
      () => citation({ documentId: docB.documentId }),
    ],
  ])('refuses %s and stores no answer', async (_, make) => {
    await expect(answerWith([citation(), make()])).rejects.toBeInstanceOf(
      CitedEvidenceUnavailableError,
    );
    // The transaction rolled back: no assistant message and no citations.
    const all = await db.select().from(answerCitations);
    expect(
      all.every((row) => row.organizationId === scopeA.organizationId),
    ).toBe(true);
  });

  it('refuses evidence from documents that are not READY', async () => {
    const deleting = await seedIndexedDocument(
      db,
      { organizationId: scopeA.organizationId, uploadedBy: userId },
      {
        filename: 'Deleting.pdf',
        status: 'DELETING',
        chunks: [{ content: 'stale', embedding: axisVector(2) }],
      },
    );

    await expect(
      answerWith([
        citation({
          documentId: deleting.documentId,
          chunkId: deleting.chunkIds[0]!,
        }),
      ]),
    ).rejects.toBeInstanceOf(CitedEvidenceUnavailableError);
  });

  it('enforces unique ordinals and labels per answer', async () => {
    await expect(
      answerWith([
        citation(),
        citation({ sourceLabel: 'SOURCE_2', chunkId: docA.chunkIds[1]! }),
      ]),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23505' }),
    });
  });

  it('marks citations unavailable, without text, once the evidence is deleted', async () => {
    const doc = await seedIndexedDocument(
      db,
      { organizationId: scopeA.organizationId, uploadedBy: userId },
      {
        filename: 'Temp.pdf',
        chunks: [{ content: 'temporary evidence', embedding: axisVector(3) }],
      },
    );
    const { messageId } = await answerWith([
      citation({ documentId: doc.documentId, chunkId: doc.chunkIds[0]! }),
    ]);
    // What deletion cleanup does: chunks removed, document DELETED.
    await db
      .delete(documentChunks)
      .where(eq(documentChunks.documentId, doc.documentId));
    await db
      .update(documents)
      .set({ status: 'DELETED' })
      .where(eq(documents.id, doc.documentId));

    const [view] = await citations.listForMessages(scopeA, [messageId]);
    expect(view).toMatchObject({
      available: false,
      chunkContent: null,
      documentName: 'Temp.pdf',
    });
    const [row] = await db
      .select()
      .from(answerCitations)
      .where(eq(answerCitations.messageId, messageId));
    expect(row!.chunkId).toBeNull();
  });

  it('rejects cross-tenant citation rows at the database level', async () => {
    const { messageId } = await answerWith([citation()]);

    await expect(
      db.insert(answerCitations).values({
        organizationId: scopeA.organizationId,
        messageId,
        documentId: docB.documentId,
        chunkId: docB.chunkIds[0]!,
        ordinal: 9,
        sourceLabel: 'SOURCE_9',
        locator: { page: null, section: null, charStart: 0, charEnd: 1 },
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23503' }),
    });
  });
});
