/**
 * LOCAL: inspect remaining active BidCandidates and optionally clear per mailbox.
 * Usage: npx tsx apps/api/scripts/inspect-and-clear-orphans.ts [--clear]
 */
import { PrismaClient } from "@prisma/client";
import { clearBiddingAnalysisStaging } from "../src/application/services/clear-bidding-analysis.js";
import { activeBidCandidatesForMailboxWhere } from "../src/application/services/bid-candidate-mailbox-scope.js";

const p = new PrismaClient();
const doClear = process.argv.includes("--clear");

async function main() {
  const conns = await p.inboxConnection.findMany({
    select: { id: true, email: true, workspaceId: true },
  });
  for (const c of conns) {
    const active = await p.bidCandidate.findMany({
      where: activeBidCandidatesForMailboxWhere({
        workspaceId: c.workspaceId,
        connectionId: c.id,
      }),
      select: {
        id: true,
        status: true,
        proposedProjectName: true,
        originalBidSource: true,
        _count: { select: { emails: true, quoteStagings: true } },
      },
    });
    const discovery = await p.bidFolderDiscoveryEmail.count({
      where: { inboxConnectionId: c.id },
    });
    const quotes = await p.bidQuoteStaging.count({
      where: { inboxConnectionId: c.id },
    });
    if (active.length || discovery || quotes) {
      console.log(
        JSON.stringify(
          {
            email: c.email,
            connectionId: c.id,
            discovery,
            quotes,
            activeCandidates: active,
          },
          null,
          2
        )
      );
      if (doClear && (active.length || discovery || quotes)) {
        const result = await clearBiddingAnalysisStaging({
          prisma: p,
          workspaceId: c.workspaceId,
          connectionId: c.id,
        });
        console.log("CLEARED", result);
        const after = await p.bidCandidate.count({
          where: activeBidCandidatesForMailboxWhere({
            workspaceId: c.workspaceId,
            connectionId: c.id,
          }),
        });
        console.log("ACTIVE_AFTER", after);
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
