import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../auth/public.decorator.js';
import { ACCESS_POLICY } from '../authorization/authorize.decorator.js';
import { startTestApi, type TestApi } from '../testing/test-api.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import {
  startTestIdentityProvider,
  type TestIdentityProvider,
} from '../testing/test-identity-provider.js';

interface Route {
  name: string;
  method: string;
  path: string;
  isPublic: boolean;
  policy: string | undefined;
}

/** Enumerates every HTTP route registered in the application. */
function listRoutes(api: TestApi): Route[] {
  const reflector = new Reflector();
  const routes: Route[] = [];
  for (const module of api.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as
        (new (...args: never[]) => object) | null;
      if (!controller) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      for (const key of Object.getOwnPropertyNames(controller.prototype)) {
        if (key === 'constructor') continue;
        const handler = (controller.prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;
        if (path === undefined) continue;
        const method = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        ) as RequestMethod;
        const targets = [handler, controller];
        routes.push({
          name: `${controller.name}.${key}`,
          method: RequestMethod[method]!,
          path: `/${[base, path].filter((p) => p && p !== '/').join('/')}`,
          isPublic:
            reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false,
          policy: reflector.getAllAndOverride<string>(ACCESS_POLICY, targets),
        });
      }
    }
  }
  return routes;
}

describe('route protection (E1-T06)', () => {
  let db: TestDatabase;
  let idp: TestIdentityProvider;
  let api: TestApi;
  let routes: Route[];

  beforeAll(async () => {
    db = await createTestDatabase();
    idp = await startTestIdentityProvider();
    api = await startTestApi(db.url, idp);
    routes = listRoutes(api);
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

  it('only health endpoints are public', () => {
    expect(
      routes
        .filter((r) => r.isPublic)
        .map((r) => r.path)
        .sort(),
    ).toEqual(['/health', '/ready']);
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
