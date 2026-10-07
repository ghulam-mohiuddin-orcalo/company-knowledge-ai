const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The only way to build a document's object key: tenant- and document-prefixed,
 * from server-generated UUIDs only. User-supplied filenames never reach the path.
 */
export function documentObjectKey(
  organizationId: string,
  documentId: string,
): string {
  if (!UUID.test(organizationId) || !UUID.test(documentId)) {
    throw new Error('Object keys require lowercase UUID identifiers');
  }
  return `org/${organizationId}/documents/${documentId}/original`;
}
