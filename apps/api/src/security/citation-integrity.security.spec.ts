import { randomUUID } from 'node:crypto';
import {
  FakeGenerationProvider,
  type GenerationRequest,
  HashedTermEmbeddingProvider,
} from '@cka/ai';
import {
  answerCitations,
  type Database,
  documentChunks,
  documents,
  EMBEDDING_DIMENSIONS,
} from '@cka/database';
import { makeDocx, makePdf } from '@cka/ingestion/fixtures';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';
import { GENERATION_PROVIDER, NO_ANSWER_MESSAGE } from '../rag/rag.service.js';
import { EMBEDDING_PROVIDER } from '../retrieval/retrieval.service.js';
import { indexUploadedDocument } from '../testing/index-document.js';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  expectDeniedWithoutLeak,
  expectNoLeak,
} from '../testing/tenant-boundary.js';
import {
  seedTenantFixtures,
  type TenantFixtures,
} from '../testing/tenant-fixtures.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from '../testing/test-identity-provider.js';

const embedder = new HashedTermEmbeddingProvider(EMBEDDING_DIMENSIONS);
const PDF = 'application/pdf';
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface Citation {
  id: string;
  ordinal: number;
  documentId: string;
  documentName: string;
  locator: { page: number | null; section: string | null };
  excerpt: string | null;
  available: boolean;
}
interface AskBody {
  answer: { content: string; outcome: string; citations: Citation[] };
}

/** Citation integrity gate (E6-T05). */
describe('citation integrity (E6)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  let database: Database;
  let respond: (request: GenerationRequest) => string | Promise<string>;
  const generation = new FakeGenerationProvider((r) => respond(r));
  const pdfBytes = makePdf([
    [
      'Expense policy overview.',
      'Expenses are submitted in Spendly within 30 days.',
    ],
    [
      'Travel booking.',
      'Flights must be booked through the TravelPoint travel desk.',
    ],
  ]);
  let pdfId: string;
  let docxId: string;
  let orgBDocId: string;

  const upload = async (
    token: string,
    name: string,
    bytes: Buffer,
    type: string,
  ) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    const response = await api.request('/v1/documents', {
      method: 'POST',
      body: form,
      token,
    });
    const id = (response.body as { id: string }).id;
    await indexUploadedDocument(database, id, bytes, embedder);
    return id;
  };
  const askAs = async (token: string, content: string) => {
    const conversation = await api.request('/v1/conversations', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const response = await api.request(
      `/v1/conversations/${(conversation.body as { id: string }).id}/messages`,
      {
        method: 'POST',
        token,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      },
    );
    return { response, body: response.body as AskBody };
  };
  /** A model that cites every source it was given, plus whatever `extra` says. */
  const citeAll =
    (extra = '') =>
    (request: GenerationRequest) =>
      `Answer ${[...request.user.matchAll(/id="(SOURCE_\d+)"/g)].map((m) => `[${m[1]}]`).join(' ')} ${extra}`;

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(
      db.url,
      idp,
      { EVIDENCE_MIN_TOP_SCORE: '0.25', EVIDENCE_MIN_HIT_SCORE: '0.15' },
      (builder) =>
        builder
          .overrideProvider(EMBEDDING_PROVIDER)
          .useValue(embedder)
          .overrideProvider(GENERATION_PROVIDER)
          .useValue(generation),
    );
    fx = await seedTenantFixtures(api.app, idp, 'cit');
    database = api.app.get(DATABASE);
    const adminA = await fx.adminA.token();
    pdfId = await upload(adminA, 'Expense Policy.pdf', pdfBytes, PDF);
    docxId = await upload(
      adminA,
      'Handbook.docx',
      await makeDocx([
        { heading: 1, text: 'Annual Leave' },
        { paragraph: 'Employees receive 27 days of annual leave per year.' },
      ]),
      DOCX,
    );
    orgBDocId = await upload(
      await fx.adminB.token(),
      'Org B Travel.pdf',
      makePdf([['Org B travel desk is TravelPoint North for flights booked.']]),
      PDF,
    );
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  beforeEach(() => {
    generation.requests.length = 0;
    respond = citeAll();
  });

  it('resolves a PDF citation to its page and streams the private original', async () => {
    respond = (request) =>
      `Flights go through TravelPoint [${/id="(SOURCE_\d+)"[^>]*location="page 2"/.exec(request.user)![1]}].`;
    const token = await fx.memberA.token();
    const { body } = await askAs(
      token,
      'Where must flights be booked through the travel desk?',
    );

    expect(body.answer.outcome).toBe('ANSWERED');
    expect(body.answer.content).toBe('Flights go through TravelPoint [1].');
    const [citation] = body.answer.citations;
    expect(citation).toMatchObject({
      ordinal: 1,
      documentId: pdfId,
      documentName: 'Expense Policy.pdf',
      locator: { page: 2, section: null },
      available: true,
    });

    const source = await api.request(`/v1/citations/${citation!.id}/source`, {
      token,
    });
    expect(source.status).toBe(200);
    expect(source.body).toEqual({
      citationId: citation!.id,
      ordinal: 1,
      document: { id: pdfId, name: 'Expense Policy.pdf', mimeType: PDF },
      locator: { page: 2, section: null },
      text: 'Travel booking.\nFlights must be booked through the TravelPoint travel desk.',
      originalUrl: `/v1/citations/${citation!.id}/source/original`,
    });
    expect(source.text).not.toMatch(/storage|org\/|chunk/i);

    const original = await fetch(
      `${await api.app.getUrl()}/v1/citations/${citation!.id}/source/original`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(original.status).toBe(200);
    expect(original.headers.get('content-type')).toBe(PDF);
    expect(original.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''Expense%20Policy.pdf",
    );
    expect(original.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await original.arrayBuffer()).equals(pdfBytes)).toBe(
      true,
    );
  });

  it('resolves a DOCX citation to its section', async () => {
    const token = await fx.memberA.token();
    const { body } = await askAs(
      token,
      'How many days of annual leave do employees receive?',
    );
    const citation = body.answer.citations.find(
      (c) => c.documentId === docxId,
    )!;

    expect(citation.locator).toEqual({ page: null, section: 'Annual Leave' });
    const source = await api.request(`/v1/citations/${citation.id}/source`, {
      token,
    });
    expect(source.body).toMatchObject({
      locator: { section: 'Annual Leave' },
      text: 'Annual Leave\n\nEmployees receive 27 days of annual leave per year.',
    });
  });

  it('cites only evidence that was retrieved and sent for this answer', async () => {
    const token = await fx.memberA.token();
    const { body } = await askAs(
      token,
      'Where must flights be booked through the travel desk?',
    );
    const [request] = generation.requests;

    expect(body.answer.citations.length).toBeGreaterThan(0);
    for (const citation of body.answer.citations) {
      const [row] = await database
        .select({
          content: documentChunks.content,
          organizationId: documentChunks.organizationId,
        })
        .from(answerCitations)
        .innerJoin(
          documentChunks,
          eq(documentChunks.id, answerCitations.chunkId),
        )
        .where(eq(answerCitations.id, citation.id));
      expect(row!.organizationId).toBe(fx.orgA.id);
      // The cited chunk's text was in the prompt's evidence for this answer.
      expect(request!.user).toContain(row!.content);
    }
  });

  it('ignores fabricated labels and model-written document IDs', async () => {
    respond = citeAll(
      `[SOURCE_9] [SOURCE_42] see document ${orgBDocId} [doc:${orgBDocId}]`,
    );
    const token = await fx.memberA.token();
    const { body } = await askAs(
      token,
      'Where must flights be booked through the travel desk?',
    );

    expect(body.answer.content).not.toMatch(/SOURCE_/);
    expect(body.answer.citations.map((c) => c.ordinal)).toEqual(
      body.answer.citations.map((_, i) => i + 1),
    );
    for (const citation of body.answer.citations) {
      expect([pdfId, docxId]).toContain(citation.documentId);
    }
    const rows = await database.select().from(answerCitations);
    expect(rows.filter((r) => r.documentId === orgBDocId)).toEqual([]);
  });

  it('gives the no-answer, without citations, when only fabricated labels are cited', async () => {
    respond = () => `Org B uses TravelPoint North [SOURCE_7] (${orgBDocId}).`;
    const { body } = await askAs(
      await fx.memberA.token(),
      'Where must flights be booked through the travel desk?',
    );

    expect(body.answer).toMatchObject({
      outcome: 'NO_ANSWER',
      content: NO_ANSWER_MESSAGE,
      citations: [],
    });
  });

  it('makes citations of deleted documents unavailable (no stale content)', async () => {
    const adminA = await fx.adminA.token();
    const temp = await upload(
      adminA,
      'Parking.pdf',
      makePdf([
        ['Parking spaces are allocated by the facilities team weekly.'],
      ]),
      PDF,
    );
    const token = await fx.memberA.token();
    const { body } = await askAs(
      token,
      'How are parking spaces allocated by the facilities team?',
    );
    const citation = body.answer.citations.find((c) => c.documentId === temp)!;
    expect(citation.available).toBe(true);

    // Admin deletes; then the worker's cleanup removes chunks.
    expect(
      (
        await api.request(`/v1/documents/${temp}`, {
          method: 'DELETE',
          token: adminA,
        })
      ).status,
    ).toBe(204);
    const deleting = await api.request(`/v1/citations/${citation.id}/source`, {
      token,
    });
    await database
      .delete(documentChunks)
      .where(eq(documentChunks.documentId, temp));
    await database
      .update(documents)
      .set({ status: 'DELETED' })
      .where(eq(documents.id, temp));
    const deleted = await api.request(`/v1/citations/${citation.id}/source`, {
      token,
    });
    const original = await api.request(
      `/v1/citations/${citation.id}/source/original`,
      { token },
    );

    for (const response of [deleting, deleted, original]) {
      expect(response.status).toBe(410);
      expect(response.body).toEqual({
        error: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'This source is no longer available.',
        },
      });
      expectNoLeak(response, ['Parking spaces are allocated']);
    }
    const conversations = await api.request('/v1/conversations', { token });
    const history = await Promise.all(
      (conversations.body as { items: { id: string }[] }).items.map((c) =>
        api.request(`/v1/conversations/${c.id}/messages`, { token }),
      ),
    );
    const stale = history
      .flatMap((h) => (h.body as { items: { citations: Citation[] }[] }).items)
      .flatMap((m) => m.citations)
      .find((c) => c.id === citation.id)!;
    expect(stale).toMatchObject({ available: false, excerpt: null });
  });

  it('never cites a document deleted while the answer was being generated', async () => {
    const adminA = await fx.adminA.token();
    const racing = await upload(
      adminA,
      'Lockers.pdf',
      makePdf([['Office lockers are assigned by the reception desk monthly.']]),
      PDF,
    );
    respond = async (request) => {
      // The admin deletes the document while the model is still answering.
      await database
        .update(documents)
        .set({ status: 'DELETING' })
        .where(eq(documents.id, racing));
      return citeAll()(request);
    };

    const { body } = await askAs(
      await fx.memberA.token(),
      'How are office lockers assigned by the reception desk?',
    );

    expect(generation.requests).toHaveLength(1);
    expect(body.answer).toMatchObject({
      outcome: 'NO_ANSWER',
      content: NO_ANSWER_MESSAGE,
      citations: [],
    });
    const rows = await database
      .select()
      .from(answerCitations)
      .where(eq(answerCitations.documentId, racing));
    expect(rows).toEqual([]);
  });

  it('denies other users and other tenants, indistinguishably from unknown IDs', async () => {
    const { body } = await askAs(
      await fx.memberA.token(),
      'Where must flights be booked through the travel desk?',
    );
    const citationId = body.answer.citations[0]!.id;
    const markers = ['TravelPoint', 'Expense Policy', pdfId];

    for (const user of [fx.adminA, fx.memberB, fx.adminB, fx.platformAdmin]) {
      const token = await user.token();
      for (const suffix of ['source', 'source/original']) {
        const response = await api.request(
          `/v1/citations/${citationId}/${suffix}`,
          { token },
        );
        const unknown = await api.request(
          `/v1/citations/${randomUUID()}/${suffix}`,
          { token },
        );
        expect(response.status).toBe(user === fx.platformAdmin ? 403 : 404);
        if (response.status === 404)
          expectDeniedWithoutLeak(response, 404, markers);
        expect(response.body).toEqual(unknown.body);
      }
    }
    const viaHeader = await api.request(`/v1/citations/${citationId}/source`, {
      token: await fx.memberA.token(),
      headers: { 'x-organization-id': fx.orgB.id },
    });
    expect(viaHeader.status).toBe(403);
    expect(
      (await api.request(`/v1/citations/${citationId}/source`)).status,
    ).toBe(401);
  });

  it('rejects tampered citation identifiers', async () => {
    const token = await fx.memberA.token();
    for (const id of [
      'not-a-uuid',
      `${randomUUID()}'--`,
      '..%2F..%2Fdocuments',
    ]) {
      const response = await api.request(`/v1/citations/${id}/source`, {
        token,
      });
      expect([400, 404]).toContain(response.status);
      expect(response.body).toMatchObject({
        error: { code: expect.any(String) },
      });
    }
  });
});
