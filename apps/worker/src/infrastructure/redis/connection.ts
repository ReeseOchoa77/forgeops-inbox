import type { ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

export const createRedisConnection = (url: string): Redis =>
  new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });

export const createBullMqConnection = (url: string): ConnectionOptions => {
  const parsedUrl = new URL(url);
  const database = parsedUrl.pathname.length > 1
    ? Number(parsedUrl.pathname.slice(1))
    : null;

  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 6379,
    ...(parsedUrl.username
      ? { username: decodeURIComponent(parsedUrl.username) }
      : {}),
    ...(parsedUrl.password
      ? { password: decodeURIComponent(parsedUrl.password) }
      : {}),
    ...(database !== null && !Number.isNaN(database) ? { db: database } : {}),
    ...(parsedUrl.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  };
};
