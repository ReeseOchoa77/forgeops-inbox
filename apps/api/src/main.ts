import { buildServer } from "./interfaces/http/server.js";

const start = async (): Promise<void> => {
  const app = await buildServer();
  const host = app.services.env.HOST;
  const port = app.services.env.API_PORT;

  await app.listen({ host, port });
  app.log.info({ host, port }, "API listening");
};

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

