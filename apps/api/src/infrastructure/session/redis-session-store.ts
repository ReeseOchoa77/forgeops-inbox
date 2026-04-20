import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";

import {
  authSessionSchema,
  type AuthSession
} from "../../domain/auth/auth-session.js";

export interface RedisSessionStoreOptions {
  prefix?: string;
  ttlSeconds: number;
}

export class RedisSessionStore {
  private readonly prefix: string;

  constructor(
    private readonly redis: Redis,
    private readonly options: RedisSessionStoreOptions
  ) {
    this.prefix = options.prefix ?? "auth:session";
  }

  async create(session: AuthSession): Promise<string> {
    const id = randomUUID();
    await this.redis.set(
      this.buildKey(id),
      JSON.stringify(session),
      "EX",
      this.options.ttlSeconds
    );

    return id;
  }

  async get(sessionId: string): Promise<AuthSession | null> {
    const raw = await this.redis.get(this.buildKey(sessionId));
    if (!raw) {
      return null;
    }

    return authSessionSchema.parse(JSON.parse(raw));
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(this.buildKey(sessionId));
  }

  private buildKey(sessionId: string): string {
    return `${this.prefix}:${sessionId}`;
  }
}
