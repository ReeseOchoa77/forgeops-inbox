import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  console.log({
    quotes: await p.bidQuoteStaging.count(),
    candidates: await p.bidCandidate.count(),
    discovery: await p.bidFolderDiscoveryEmail.count(),
    runs: await p.bidAnalysisRun.count(),
    messages: await p.emailMessage.count(),
    workspaces: await p.workspace.count(),
  });
  const ws = await p.workspace.findMany({
    select: { id: true, name: true, slug: true },
  });
  for (const w of ws) {
    console.log(w.slug, {
      q: await p.bidQuoteStaging.count({ where: { workspaceId: w.id } }),
      c: await p.bidCandidate.count({ where: { workspaceId: w.id } }),
      emails: await p.emailMessage.count({ where: { workspaceId: w.id } }),
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
