import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";

import {
  googleOAuthStateSchema,
  type GoogleOAuthState
} from "../../domain/google/oauth-state.js";

export type GoogleOAuthFlow = GoogleOAuthState["flow"];

export interface GoogleOAuthStateStoreOptions {
  prefix?: string;
  ttlSeconds: number;
}

export interface GoogleOAuthStateWriteResult {
  flow: GoogleOAuthFlow;
  stateId: string;
  storageKey: string;
  ttlSeconds: number;
  written: boolean;
}

export interface GoogleOAuthStateReadResult {
  flow: GoogleOAuthFlow;
  stateId: string;
  storageKey: string;
  found: boolean;
  ttlSeconds: number | null;
  state: GoogleOAuthState | null;
}

export class GoogleOAuthStateStore {
  private readonly prefix: string;

  constructor(
    private readonly redis: Redis,
    private readonly options: GoogleOAuthStateStoreOptions
  ) {
    this.prefix = options.prefix ?? "google:oauth-state";
  }

  async create(state: GoogleOAuthState): Promise<GoogleOAuthStateWriteResult> {
    const stateId = randomUUID();
    const storageKey = this.buildKey(state.flow, stateId);

    await this.redis.set(
      storageKey,
      JSON.stringify(state),
      "EX",
      this.options.ttlSeconds
    );

    const verification = await this.redis.get(storageKey);

    return {
      flow: state.flow,
      stateId,
      storageKey,
      ttlSeconds: this.options.ttlSeconds,
      written: verification !== null
    };
  }

  async consume(
    flow: GoogleOAuthFlow,
    stateId: string
  ): Promise<GoogleOAuthStateReadResult> {
    const storageKey = this.buildKey(flow, stateId);
    const raw = await this.redis.get(storageKey);

    if (!raw) {
      return {
        flow,
        stateId,
        storageKey,
        found: false,
        ttlSeconds: null,
        state: null
      };
    }

    const ttlSeconds = await this.redis.ttl(storageKey);
    await this.redis.del(storageKey);

    return {
      flow,
      stateId,
      storageKey,
      found: true,
      ttlSeconds: ttlSeconds >= 0 ? ttlSeconds : null,
      state: googleOAuthStateSchema.parse(JSON.parse(raw))
    };
  }

  private buildKey(flow: GoogleOAuthFlow, stateId: string): string {
    return `${this.prefix}:${flow}:${stateId}`;
  }
}
