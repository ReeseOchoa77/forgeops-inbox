import type { PrismaClient } from "@prisma/client";
import {
  TokenCipher,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
} from "@forgeops/shared";

import { AttachmentIngestionService } from "../services/attachment-ingestion.service.js";
import type { OutlookClient } from "../../infrastructure/providers/outlook/outlook-client.js";
import type { AttachmentStorage } from "../../infrastructure/storage/attachment-storage.js";

export class AttachmentIngestProcessor {
  private readonly service: AttachmentIngestionService;

  constructor(
    prisma: PrismaClient,
    tokenCipher: TokenCipher,
    outlookClient: OutlookClient,
    storage: AttachmentStorage,
    maxSizeBytes: number
  ) {
    this.service = new AttachmentIngestionService(
      prisma,
      tokenCipher,
      outlookClient,
      storage,
      maxSizeBytes
    );
  }

  async process(payload: AttachmentIngestJobPayload): Promise<AttachmentIngestResult> {
    return this.service.process(payload);
  }
}
