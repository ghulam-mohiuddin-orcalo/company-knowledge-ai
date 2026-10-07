import type { TenantFixtures } from './tenant-fixtures.js';

import type { TestResponse } from './test-api.js';

export type ApiResponse = TestResponse;

/** Every identifying value of Org B (the "foreign" tenant) that must never reach Org A callers. */
export function foreignTenantMarkers(fx: TenantFixtures): string[] {
  return [
    fx.orgB.id,
    fx.orgB.name,
    fx.adminB.userId,
    fx.adminB.subject,
    fx.adminB.membershipId!,
    fx.memberB.userId,
    fx.memberB.subject,
    fx.memberB.membershipId!,
  ];
}

/** Asserts a denial uses the error envelope and leaks none of the given markers. */
export function expectDeniedWithoutLeak(
  response: ApiResponse,
  status: 403 | 404,
  markers: string[],
): void {
  expect(response.status).toBe(status);
  expect(response.body).toEqual({
    error: {
      code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
      message: expect.any(String),
    },
  });
  for (const marker of markers) {
    expect(response.text).not.toContain(marker);
  }
}

/** Asserts a successful response contains none of the given markers. */
export function expectNoLeak(response: ApiResponse, markers: string[]): void {
  for (const marker of markers) {
    expect(response.text).not.toContain(marker);
  }
}
