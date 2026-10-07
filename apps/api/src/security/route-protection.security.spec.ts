import { listRoutes, type Route } from '../testing/routes.js';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from '../testing/test-identity-provider.js';

describe('route protection (E1-T06)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let routes: Route[];

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);
    routes = listRoutes(api.app);
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('discovers the application routes', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /health',
        'GET /ready',
        'GET /v1/me',
        'GET /v1/organization',
        'GET /v1/organization/members',
        'GET /v1/organization/members/:membershipId',
        'GET /v1/platform/organizations',
      ]),
    );
  });

  it('only health endpoints and the token-gated metrics scrape are public', () => {
    expect(
      routes
        .filter((r) => r.isPublic)
        .map((r) => r.path)
        .sort(),
    ).toEqual(['/health', '/metrics', '/ready']);
  });

  it('the metrics scrape is not reachable without its own token', async () => {
    const token = await idp.token('sec-metrics');
    // Disabled (no METRICS_TOKEN): indistinguishable from an unknown route.
    expect((await api.request('/metrics', { token })).status).toBe(404);
  });

  it('every protected route declares an access policy', () => {
    const undeclared = routes.filter((r) => !r.isPublic && !r.policy);

    expect(undeclared.map((r) => r.name)).toEqual([]);
  });

  it('every protected route rejects unauthenticated calls with 401', async () => {
    for (const route of routes.filter((r) => !r.isPublic)) {
      const path = route.path.replace(
        /:\w+/g,
        '00000000-0000-4000-8000-000000000000',
      );
      const response = await api.request(path, { method: route.method });
      expect({ route: route.name, status: response.status }).toEqual({
        route: route.name,
        status: 401,
      });
      expect(response.body).toEqual({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required.',
        },
      });
    }
  });

  it('error responses never include stack traces or SQL', async () => {
    const token = await idp.token('sec-errors');
    const responses = [
      await api.request('/v1/organization/members/not-a-uuid', { token }),
      await api.request('/v1/organization', {
        token,
        headers: { 'x-organization-id': "'; DROP TABLE users; --" },
      }),
    ];

    for (const response of responses) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).toEqual({
        error: { code: expect.any(String), message: expect.any(String) },
      });
      expect(response.text).not.toMatch(
        /at \w+ \(|select |insert |postgres|stack/i,
      );
    }
  });
});
