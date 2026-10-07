import { startTestApi, type TestApi } from './testing/test-api.js';
import {
  createTestDatabase,
  type TestDatabase,
} from './testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from './testing/test-identity-provider.js';

describe('CORS (E7-T01)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;

  const preflight = async (origin: string) => {
    const response = await fetch(`${await api.app.getUrl()}/v1/me`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,x-organization-id',
      },
    });
    return response.headers;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp, {
      APP_PUBLIC_URL: 'http://localhost:3000',
    });
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('allows the configured web origin with the product headers', async () => {
    const headers = await preflight('http://localhost:3000');

    expect(headers.get('access-control-allow-origin')).toBe(
      'http://localhost:3000',
    );
    expect(headers.get('access-control-allow-headers')).toContain(
      'X-Organization-Id',
    );
    expect(headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('does not allow other origins', async () => {
    const headers = await preflight('https://evil.example');

    expect(headers.get('access-control-allow-origin')).toBeNull();
  });
});
