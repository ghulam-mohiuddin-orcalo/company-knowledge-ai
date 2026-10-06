/**
 * Server-side object storage boundary. Objects are private: there is no public
 * URL or ACL API, and callers never receive storage keys or credentials.
 */
export interface ObjectStorage {
  putObject(
    key: string,
    body: Buffer,
    options: { contentType: string },
  ): Promise<void>;
  /** Throws ObjectNotFoundError when the object does not exist. */
  getObject(key: string): Promise<Buffer>;
  /** Idempotent: deleting a missing object succeeds. */
  deleteObject(key: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
  }
}

/** A storage failure with a safe message (no keys, credentials or provider payloads). */
export class ObjectStorageError extends Error {
  constructor(
    readonly operation: 'put' | 'get' | 'delete',
    readonly reason: string,
  ) {
    super(`Object storage ${operation} failed: ${reason}`);
    this.name = 'ObjectStorageError';
  }
}
