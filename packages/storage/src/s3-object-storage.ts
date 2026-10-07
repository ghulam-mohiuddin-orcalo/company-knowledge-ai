import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { AppConfig } from '@cka/config';
import {
  ObjectNotFoundError,
  type ObjectStorage,
  ObjectStorageError,
} from './object-storage.js';

/** S3-compatible adapter (AWS S3, SeaweedFS, MinIO, ...). Objects are written without public ACLs. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig['storage']) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKey.reveal(),
        secretAccessKey: config.secretKey.reveal(),
      },
      maxAttempts: 3,
    });
  }

  async putObject(
    key: string,
    body: Buffer,
    options: { contentType: string },
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          ContentLength: body.length,
        }),
      );
    } catch (error) {
      throw new ObjectStorageError('put', describe(error));
    }
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) throw new ObjectNotFoundError();
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof ObjectNotFoundError || error instanceof NoSuchKey) {
        throw new ObjectNotFoundError();
      }
      throw new ObjectStorageError('get', describe(error));
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      throw new ObjectStorageError('delete', describe(error));
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}

// Error name and HTTP status only: never request details or credentials.
function describe(error: unknown): string {
  if (error instanceof S3ServiceException) {
    return `${error.name} (HTTP ${error.$metadata.httpStatusCode ?? 'unknown'})`;
  }
  return error instanceof Error ? error.name : 'unknown error';
}
