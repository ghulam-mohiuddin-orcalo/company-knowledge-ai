import { ObjectNotFoundError, type ObjectStorage } from './object-storage.js';

/** In-process ObjectStorage for tests. */
export class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async putObject(
    key: string,
    body: Buffer,
    options: { contentType: string },
  ): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), ...options });
  }

  async getObject(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new ObjectNotFoundError();
    return Buffer.from(object.body);
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
