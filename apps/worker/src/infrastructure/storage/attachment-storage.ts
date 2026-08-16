import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Same contract as apps/api attachment storage — keep key patterns compatible. */
export interface AttachmentStorage {
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getSignedDownloadUrl(
    key: string,
    filename: string,
    contentType: string,
    expiresInSeconds?: number
  ): Promise<string>;
  getObject(key: string): Promise<{ data: Buffer; contentType: string }>;
  readonly configured: boolean;
}

export interface AttachmentStorageConfig {
  bucket?: string | undefined;
  region?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  endpoint?: string | undefined;
}

export class S3AttachmentStorage implements AttachmentStorage {
  private client: S3Client | null = null;
  private bucket: string;
  readonly configured: boolean;

  constructor(config: AttachmentStorageConfig) {
    this.bucket = config.bucket ?? "";
    this.configured = !!(
      config.bucket &&
      config.accessKeyId &&
      config.secretAccessKey
    );

    if (this.configured) {
      this.client = new S3Client({
        region: config.region ?? "us-east-1",
        credentials: {
          accessKeyId: config.accessKeyId!,
          secretAccessKey: config.secretAccessKey!,
        },
        ...(config.endpoint
          ? { endpoint: config.endpoint, forcePathStyle: true }
          : {}),
      });
    }
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new Error(
        "S3 storage is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY."
      );
    }
    return this.client;
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<void> {
    const client = this.requireClient();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
  }

  async delete(key: string): Promise<void> {
    const client = this.requireClient();
    await client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  async exists(key: string): Promise<boolean> {
    const client = this.requireClient();
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async getSignedDownloadUrl(
    key: string,
    filename: string,
    contentType: string,
    expiresInSeconds = 900
  ): Promise<string> {
    const client = this.requireClient();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  async getObject(key: string): Promise<{ data: Buffer; contentType: string }> {
    const client = this.requireClient();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    const body = await response.Body?.transformToByteArray();
    if (!body) throw new Error("Empty response body from S3");
    return {
      data: Buffer.from(body),
      contentType: response.ContentType ?? "application/octet-stream",
    };
  }
}
