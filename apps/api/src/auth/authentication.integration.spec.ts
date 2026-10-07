import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from '../testing/test-identity-provider.js';

const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' },
};

describe('authentication (E1-T01)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);
  });

  afterAll(async () => {
    await api?.close();
    await idp?.close();
    await db?.drop();
  });

  it('returns 401 for protected calls without a token', async () => {
    const response = await api.request('/v1/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
  });

  it.each([
    ['a non-bearer scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['a malformed bearer value', { authorization: 'Bearer not-a-token' }],
  ])('returns 401 for %s', async (_, headers) => {
    const response = await api.request('/v1/me', { headers });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED);
  });

  it('returns 401 for invalid tokens without revealing why', async () => {
    for (const token of [
      await idp.token('u', {}, { expiresIn: -60 }),
      await idp.token('u', {}, { key: 'foreign' }),
      await idp.token('u', { aud: 'other-api' }),
    ]) {
      const response = await api.request('/v1/me', { token });
      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
    }
  });

  it('maps a verified identity to an internal user on first sign-in', async () => {
    const token = await idp.token('subject-new', {
      email: 'new@example.test',
      name: 'New User',
    });

    const first = await api.request('/v1/me', { token });
    const second = await api.request('/v1/me', { token });

    expect(first.status).toBe(200);
    const user = (first.body as { user: { id: string } }).user;
    expect(user).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      email: 'new@example.test',
      displayName: 'New User',
      isPlatformAdmin: false,
    });
    // The internal ID is ours, not the provider subject, and is stable.
    expect(user.id).not.toBe('subject-new');
    expect((second.body as { user: { id: string } }).user.id).toBe(user.id);
  });

  it('keeps the internal user in sync with the provider profile', async () => {
    const before = await api.request('/v1/me', {
      token: await idp.token('subject-sync', { email: 'old@example.test' }),
    });
    const after = await api.request('/v1/me', {
      token: await idp.token('subject-sync', {
        email: 'new@example.test',
        name: 'Renamed',
      }),
    });

    expect(after.body).toEqual({
      user: {
        id: (before.body as { user: { id: string } }).user.id,
        email: 'new@example.test',
        displayName: 'Renamed',
        isPlatformAdmin: false,
      },
      activeOrganization: null,
      organizations: [],
    });
  });

  it('keeps health endpoints public', async () => {
    expect((await api.request('/health')).status).toBe(200);
    expect((await api.request('/ready')).status).toBe(200);
  });

  it('returns the error envelope for unknown routes', async () => {
    const response = await api.request('/v1/does-not-exist', {
      token: await idp.token('subject-new', { email: 'new@example.test' }),
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    });
  });
});
