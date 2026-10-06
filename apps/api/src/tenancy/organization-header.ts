import { ORGANIZATION_HEADER, type TenantRequest } from './principal.js';

/** Reads the organization selection header; repeated or empty values are invalid. */
export function readOrganizationHeader(
  request: TenantRequest,
): string | undefined {
  const value = request.headers[ORGANIZATION_HEADER];
  if (value === undefined) return undefined;
  if (Array.isArray(value) || value.trim() === '') return '';
  return value.trim();
}
