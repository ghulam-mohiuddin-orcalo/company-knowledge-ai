import { type INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../auth/public.decorator.js';
import { ACCESS_POLICY } from '../authorization/authorize.decorator.js';

export interface Route {
  name: string;
  method: string;
  path: string;
  isPublic: boolean;
  policy: string | undefined;
}

/** Enumerates every HTTP route registered in the application. */
export function listRoutes(app: INestApplication): Route[] {
  const reflector = new Reflector();
  const routes: Route[] = [];
  for (const module of app.get(ModulesContainer).values()) {
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

/** Fills route parameters with a well-formed but unknown UUID. */
export const concretePath = (route: Route): string =>
  route.path.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000');
