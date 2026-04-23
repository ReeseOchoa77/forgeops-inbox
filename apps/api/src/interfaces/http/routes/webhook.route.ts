import { google } from "googleapis";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { QueueNames } from "@forgeops/shared";

const gmailPubSubSchema = z.object({
  message: z.object({
    data: z.string(),
    messageId: z.string().optional(),
    publishTime: z.string().optional()
  }),
  subscription: z.string().optional()
});

const gmailNotificationSchema = z.object({
  emailAddress: z.string().email(),
  historyId: z.string().optional()
});

const outlookNotificationSchema = z.object({
  value: z.array(z.object({
    subscriptionId: z.string(),
    changeType: z.string(),
    resource: z.string(),
    clientState: z.string().optional()
  })).optional()
});

export const registerWebhookRoutes = async (
  app: FastifyInstance
): Promise<void> => {

  app.post(
    "/api/v1/webhooks/gmail",
    async (request, reply) => {
      try {
        const body = gmailPubSubSchema.parse(request.body);
        const decoded = Buffer.from(body.message.data, "base64").toString("utf-8");
        const notification = gmailNotificationSchema.parse(JSON.parse(decoded));

        const connection = await app.services.prisma.inboxConnection.findFirst({
          where: {
            provider: "GMAIL",
            email: notification.emailAddress,
            status: "ACTIVE"
          },
          select: { id: true, workspaceId: true, email: true }
        });

        if (!connection) {
          app.log.info({ event: "gmail_push_no_connection", email: notification.emailAddress });
          return reply.code(200).send({ status: "ignored" });
        }

        await app.services.inboxSyncQueue.add(
          QueueNames.INBOX_SYNC,
          {
            workspaceId: connection.workspaceId,
            inboxConnectionId: connection.id
          },
          {
            jobId: `push-sync:gmail:${connection.id}:${Date.now()}`,
            attempts: 2,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: { count: 10 },
            removeOnFail: { count: 10 },
            deduplication: { id: `push-dedup:${connection.id}`, ttl: 30000 }
          }
        );

        app.log.info({
          event: "gmail_push_sync_queued",
          email: notification.emailAddress,
          connectionId: connection.id,
          historyId: notification.historyId
        });

        return reply.code(200).send({ status: "ok" });
      } catch (error) {
        app.log.error({ event: "gmail_push_error", error: error instanceof Error ? error.message : "unknown" });
        return reply.code(200).send({ status: "error" });
      }
    }
  );

  app.post(
    "/api/v1/webhooks/outlook",
    async (request, reply) => {
      const query = request.query as Record<string, string>;
      if (query.validationToken) {
        return reply
          .header("Content-Type", "text/plain")
          .code(200)
          .send(query.validationToken);
      }

      try {
        const body = outlookNotificationSchema.parse(request.body);
        const notifications = body.value ?? [];

        for (const notification of notifications) {
          const expectedSecret = app.services.env.PUSH_WEBHOOK_SECRET;
          if (expectedSecret && notification.clientState !== expectedSecret) {
            app.log.warn({ event: "outlook_push_invalid_secret", subscriptionId: notification.subscriptionId });
            continue;
          }

          const connection = await app.services.prisma.inboxConnection.findFirst({
            where: {
              pushSubscriptionId: notification.subscriptionId,
              status: "ACTIVE"
            },
            select: { id: true, workspaceId: true, email: true }
          });

          if (!connection) {
            app.log.info({ event: "outlook_push_no_connection", subscriptionId: notification.subscriptionId });
            continue;
          }

          await app.services.inboxSyncQueue.add(
            QueueNames.INBOX_SYNC,
            {
              workspaceId: connection.workspaceId,
              inboxConnectionId: connection.id
            },
            {
              jobId: `push-sync:outlook:${connection.id}:${Date.now()}`,
              attempts: 2,
              backoff: { type: "exponential", delay: 5000 },
              removeOnComplete: { count: 10 },
              removeOnFail: { count: 10 }
            }
          );

          app.log.info({
            event: "outlook_push_sync_queued",
            email: connection.email,
            connectionId: connection.id,
            changeType: notification.changeType
          });
        }

        return reply.code(202).send({ status: "ok" });
      } catch (error) {
        app.log.error({ event: "outlook_push_error", error: error instanceof Error ? error.message : "unknown" });
        return reply.code(202).send({ status: "error" });
      }
    }
  );

  app.post(
    "/api/v1/webhooks/register-push/:connectionId",
    async (request, reply) => {
      const { connectionId } = z.object({ connectionId: z.string().min(1) }).parse(request.params);

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: { id: connectionId, status: "ACTIVE" },
        select: {
          id: true,
          workspaceId: true,
          provider: true,
          email: true,
          encryptedRefreshToken: true,
          pushSubscriptionId: true
        }
      });

      if (!connection || !connection.encryptedRefreshToken) {
        return reply.code(404).send({ message: "Connection not found or not active" });
      }

      const refreshToken = app.services.tokenCipher.decrypt(connection.encryptedRefreshToken);
      const env = app.services.env;

      try {
        if (connection.provider === "GMAIL") {
          if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GMAIL_PUBSUB_TOPIC) {
            return reply.code(503).send({ message: "Gmail push not configured (missing GMAIL_PUBSUB_TOPIC)" });
          }

          const client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_INBOX_REDIRECT_URI);
          client.setCredentials({ refresh_token: refreshToken });
          await client.getAccessToken();

          const gmail = google.gmail({ version: "v1", auth: client });
          const watchRes = await gmail.users.watch({
            userId: "me",
            requestBody: {
              topicName: env.GMAIL_PUBSUB_TOPIC,
              labelIds: ["INBOX"]
            }
          });

          const expiration = watchRes.data.expiration
            ? new Date(Number(watchRes.data.expiration))
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

          await app.services.prisma.inboxConnection.update({
            where: { id: connection.id },
            data: {
              pushSubscriptionId: `gmail-watch:${watchRes.data.historyId}`,
              pushExpiresAt: expiration
            }
          });

          return reply.send({
            status: "registered",
            provider: "gmail",
            expiresAt: expiration.toISOString(),
            historyId: watchRes.data.historyId
          });

        } else if (connection.provider === "OUTLOOK") {
          if (!env.OUTLOOK_CLIENT_ID || !env.OUTLOOK_CLIENT_SECRET) {
            return reply.code(503).send({ message: "Outlook push not configured" });
          }

          const tokenUrl = `https://login.microsoftonline.com/${env.OUTLOOK_TENANT_ID}/oauth2/v2.0/token`;
          const tokenBody = new URLSearchParams({
            client_id: env.OUTLOOK_CLIENT_ID,
            client_secret: env.OUTLOOK_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
            scope: "https://graph.microsoft.com/Mail.Read offline_access"
          });

          const tokenRes = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: tokenBody.toString()
          });

          if (!tokenRes.ok) throw new Error(`Token refresh failed: ${tokenRes.status}`);
          const tokens = await tokenRes.json() as { access_token: string };

          const webhookUrl = `${env.FRONTEND_URL.replace(/\/$/, "").replace("://", "://api.")}/api/v1/webhooks/outlook`;
          const apiBase = env.NODE_ENV === "production"
            ? webhookUrl
            : `${env.FRONTEND_URL}/api/v1/webhooks/outlook`;

          const subRes = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              changeType: "created,updated",
              notificationUrl: apiBase,
              resource: "me/mailFolders/inbox/messages",
              expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
              clientState: env.PUSH_WEBHOOK_SECRET ?? "forgeops-push"
            })
          });

          if (!subRes.ok) {
            const err = await subRes.text();
            throw new Error(`Outlook subscription failed: ${subRes.status} ${err}`);
          }

          const sub = await subRes.json() as { id: string; expirationDateTime: string };

          await app.services.prisma.inboxConnection.update({
            where: { id: connection.id },
            data: {
              pushSubscriptionId: sub.id,
              pushExpiresAt: new Date(sub.expirationDateTime)
            }
          });

          return reply.send({
            status: "registered",
            provider: "outlook",
            subscriptionId: sub.id,
            expiresAt: sub.expirationDateTime
          });

        } else {
          return reply.code(400).send({ message: "Unsupported provider" });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Push registration failed";
        app.log.error({ event: "push_registration_failed", connectionId, error: msg });
        return reply.code(500).send({ message: msg });
      }
    }
  );
};
