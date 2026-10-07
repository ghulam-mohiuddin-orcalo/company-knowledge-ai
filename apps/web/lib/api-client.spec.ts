import { ApiClient, ApiRequestError } from './api-client';

describe('ApiClient', () => {
  const onUnauthenticated = vi.fn();
  const client = new ApiClient({
    baseUrl: 'https://api.test',
    getAccessToken: async () => 'token-123',
    getOrganizationId: () => 'org-1',
    onUnauthenticated,
  });
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    onUnauthenticated.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends the bearer token and selected organization', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );

    await expect(client.request('/v1/me')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/v1/me', {
      method: 'GET',
      headers: {
        authorization: 'Bearer token-123',
        'x-organization-id': 'org-1',
      },
      body: undefined,
      signal: undefined,
    });
  });

  it('turns the error envelope into an ApiRequestError', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: 'No permission.',
            requestId: 'req_1',
          },
        }),
        { status: 403 },
      ),
    );

    await expect(client.request('/v1/x')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No permission.',
      requestId: 'req_1',
    });
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('starts sign-in again on 401', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));

    await expect(client.request('/v1/me')).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('reports network failures safely', async () => {
    fetchMock.mockRejectedValue(
      new TypeError('fetch failed: ECONNREFUSED 10.0.0.1'),
    );

    const error = await client.request('/v1/me').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(String((error as Error).message)).not.toContain('10.0.0.1');
  });
});
