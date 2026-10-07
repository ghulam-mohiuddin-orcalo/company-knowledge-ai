import { HashedTermEmbeddingProvider } from '@cka/ai';
import { EMBEDDING_DIMENSIONS } from '@cka/database';
import { EMBEDDING_PROVIDER } from '../retrieval/retrieval.service.js';
import { concretePath, listRoutes, type Route } from '../testing/routes.js';
import { startTestApi, type TestApi } from '../testing/test-api.js';
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

/**
 * Release-gate security regression suite (E8-T04). Complements the focused
 * suites (cross-tenant IDOR, RAG prompt injection, citation tampering, route
 * protection) with a full role-bypass matrix, token-claim escalation, invalid
 * uploads, safe rendering and abuse controls.
 */

/**
 * Every route and its required access level. A new or changed route fails
 * here until its policy is reviewed and added.
 */
const ACCESS_MATRIX: Record<string, string> = {
  'GET /v1/me': 'AUTHENTICATED',
  'GET /v1/organization': 'MEMBER',
  'GET /v1/organization/members': 'ORG_ADMIN',
  'GET /v1/organization/members/:membershipId': 'ORG_ADMIN',
  'GET /v1/platform/organizations': 'PLATFORM_ADMIN',
  'GET /v1/documents': 'MEMBER',
  'GET /v1/documents/:documentId': 'MEMBER',
  'POST /v1/documents': 'ORG_ADMIN',
  'DELETE /v1/documents/:documentId': 'ORG_ADMIN',
  'POST /v1/conversations': 'MEMBER',
  'GET /v1/conversations': 'MEMBER',
  'GET /v1/conversations/:conversationId/messages': 'MEMBER',
  'POST /v1/conversations/:conversationId/messages': 'MEMBER',
  'GET /v1/citations/:citationId/source': 'MEMBER',
  'GET /v1/citations/:citationId/source/original': 'MEMBER',
};

type Role = 'outsider' | 'member' | 'admin' | 'platformAdmin';

const GRANTED: Record<string, Role[]> = {
  AUTHENTICATED: ['outsider', 'member', 'admin', 'platformAdmin'],
  MEMBER: ['member', 'admin'],
  ORG_ADMIN: ['admin'],
  PLATFORM_ADMIN: ['platformAdmin'],
};

describe('security regression suite (E8-T04)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let fx: TenantFixtures;
  let routes: Route[];
  let tokens: Record<Role, string>;

  const upload = (token: string, name: string, content: string, type = '') => {
    const form = new FormData();
    form.append('file', new Blob([content], { type }), name);
    return api.request('/v1/documents', { method: 'POST', body: form, token });
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp, {}, (builder) =>
      builder
        .overrideProvider(EMBEDDING_PROVIDER)
        .useValue(new HashedTermEmbeddingProvider(EMBEDDING_DIMENSIONS)),
    );
    fx = await seedTenantFixtures(api.app, idp, 'secreg');
    routes = listRoutes(api.app).filter((r) => !r.isPublic);
    tokens = {
      outsider: await fx.outsider.token(),
      member: await fx.memberA.token(),
      admin: await fx.adminA.token(),
      platformAdmin: await fx.platformAdmin.token(),
    };
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  describe('role bypass', () => {
    it('every protected route has a reviewed access level', () => {
      const actual = Object.fromEntries(
        routes.map((r) => [`${r.method} ${r.path}`, r.policy]),
      );

      expect(actual).toEqual(ACCESS_MATRIX);
    });

    it('denies every role below the required level on every route', async () => {
      const outcomes: string[] = [];
      for (const route of routes) {
        for (const role of Object.keys(tokens) as Role[]) {
          const response = await api.request(concretePath(route), {
            method: route.method,
            token: tokens[role],
          });
          // Expected access comes from the reviewed matrix, not route metadata.
          const level = ACCESS_MATRIX[`${route.method} ${route.path}`] ?? '';
          const granted = GRANTED[level]?.includes(role) ?? false;
          const denied = response.status === 403 || response.status === 401;
          if (granted === denied) {
            outcomes.push(`${route.name} as ${role}: ${response.status}`);
          }
          if (denied) {
            expect(response.text).not.toMatch(/stack|select |at \w+ \(/i);
          }
        }
      }

      // No role is denied a capability it has, or granted one it lacks.
      expect(outcomes).toEqual([]);
    });

    it('ignores role, tenant and platform claims placed in the token', async () => {
      const forged = await idp.token(fx.memberA.subject, {
        roles: ['ORG_ADMIN', 'PLATFORM_ADMIN'],
        role: 'ORG_ADMIN',
        is_platform_admin: true,
        isPlatformAdmin: true,
        organization_id: fx.orgB.id,
        org_role: 'ORG_ADMIN',
      });

      const responses = await Promise.all([
        api.request('/v1/platform/organizations', { token: forged }),
        api.request('/v1/organization/members', { token: forged }),
        upload(forged, 'forged.txt', 'forged', 'text/plain'),
        api.request('/v1/organization', {
          token: forged,
          headers: { 'x-organization-id': fx.orgB.id },
        }),
      ]);

      expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      const me = await api.request('/v1/me', { token: forged });
      expect(me.body).toMatchObject({
        user: { isPlatformAdmin: false },
        organizations: [{ id: fx.orgA.id, role: 'MEMBER' }],
      });
    });

    it('rejects tokens that are unsigned, foreign-signed or expired', async () => {
      const [header, payload] = (await fx.adminA.token()).split('.');
      const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
      const tokensToReject = [
        unsigned,
        `${header}.${payload}.`,
        await idp.token(fx.adminA.subject, {}, { key: 'foreign' }),
        await idp.token(fx.adminA.subject, {}, { expiresIn: -60 }),
        await idp.token(fx.adminA.subject, { aud: 'another-api' }),
      ];

      for (const token of tokensToReject) {
        const response = await api.request('/v1/documents', { token });
        expect(response.status).toBe(401);
      }
    });
  });

  describe('invalid and malicious uploads', () => {
    it.each([
      ['an HTML page', 'page.html', '<script>alert(1)</script>', 'text/html'],
      ['an SVG image', 'logo.svg', '<svg onload="alert(1)"/>', 'image/svg+xml'],
      ['an executable', 'setup.exe', 'MZ\x90\x00', 'application/octet-stream'],
      [
        'an executable named .pdf',
        'report.pdf',
        'MZ\x90\x00',
        'application/pdf',
      ],
      ['HTML declared as a PDF', 'report.pdf', '<html></html>', 'text/html'],
      ['a binary .txt', 'notes.txt', '\x00\x01\x02', 'text/plain'],
      ['a ZIP disguised as .docx', 'a.docx', 'PK\x03\x04garbage', ''],
    ])('rejects %s and stores nothing', async (_, name, content, type) => {
      const before = await api.request('/v1/documents', {
        token: tokens.admin,
      });

      const response = await upload(tokens.admin, name, content, type);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: 'DOCUMENT_UNSUPPORTED_TYPE' },
      });
      const after = await api.request('/v1/documents', { token: tokens.admin });
      expect(after.body).toEqual(before.body);
    });

    it('neutralizes path traversal and control characters in file names', async () => {
      const response = await upload(
        tokens.admin,
        '../../etc/‮passwd\n.txt',
        'Plain text',
        'text/plain',
      );

      expect(response.status).toBe(201);
      const { filename } = response.body as { filename: string };
      expect(filename).toBe('passwd .txt');
    });

    it('rejects multiple files and oversized JSON safely', async () => {
      const form = new FormData();
      form.append('file', new Blob(['a'], { type: 'text/plain' }), 'a.txt');
      form.append('file', new Blob(['b'], { type: 'text/plain' }), 'b.txt');
      const multiple = await api.request('/v1/documents', {
        method: 'POST',
        body: form,
        token: tokens.admin,
      });
      const oversized = await api.request('/v1/conversations', {
        method: 'POST',
        token: tokens.member,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x'.repeat(100 * 1024) }),
      });

      expect(multiple.status).toBe(400);
      expect(oversized.status).toBe(413);
      expect(oversized.body).toMatchObject({
        error: { code: 'PAYLOAD_TOO_LARGE' },
      });
    });
  });

  describe('safe rendering', () => {
    it('returns markup in names and content as inert JSON data', async () => {
      const xss = '<img src=x onerror=alert(1)>.txt';
      const response = await upload(tokens.admin, xss, 'Hello', 'text/plain');

      expect(response.status).toBe(201);
      expect(response.headers.get('content-type')).toMatch(
        /^application\/json/,
      );
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      // Stored and returned verbatim as data; the UI renders it as text.
      expect((response.body as { filename: string }).filename).toBe(xss);
    });

    it('sends protective headers on every kind of response', async () => {
      const responses = await Promise.all([
        api.request('/health'),
        api.request('/v1/me', { token: tokens.member }),
        api.request('/v1/documents'),
        api.request('/v1/documents/00000000-0000-4000-8000-000000000000', {
          token: tokens.member,
        }),
      ]);

      for (const response of responses) {
        expect({
          nosniff: response.headers.get('x-content-type-options'),
          csp: response.headers.get('content-security-policy'),
          cache: response.headers.get('cache-control'),
          referrer: response.headers.get('referrer-policy'),
          poweredBy: response.headers.get('x-powered-by'),
          type: response.headers.get('content-type'),
        }).toEqual({
          nosniff: 'nosniff',
          csp: "default-src 'none'; frame-ancestors 'none'",
          cache: 'no-store',
          referrer: 'no-referrer',
          poweredBy: null,
          type: expect.stringMatching(/^application\/json/),
        });
      }
    });
  });

  describe('abuse controls', () => {
    it('throttles credential stuffing with a controlled 429', async () => {
      const limited = await startTestApi(db.url, idp, {
        RATE_LIMIT_AUTH_FAILURES_PER_IP: '5',
      });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 8; i++) {
          statuses.push(
            (await limited.request('/v1/me', { token: `guess-${i}` })).status,
          );
        }
        const blocked = await limited.request('/v1/me', {
          token: tokens.member,
        });

        expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429, 429]);
        expect(blocked.status).toBe(429);
        expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/);
        expect(blocked.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
      } finally {
        await limited.close();
      }
    });
  });
});
