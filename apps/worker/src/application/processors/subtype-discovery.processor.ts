import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createOpenAIClient,
  embedTextsForSubtypeDiscovery,
  interpretDiscoveryCluster,
  normalizeOpenAiApiKey,
} from "@forgeops/ai";
import {
  classifyClusterAgainstTaxonomy,
  clusterByCosineConnectedComponents,
  emptySubtypeDiscoveryProgress,
  existingSubtypeOverlap,
  prepareEmailsForDiscovery,
  resolveRequestedSampleSize,
  sampleEmailsDeterministic,
  subtypeDiscoveryAlgorithmVersions,
  type SubtypeDiscoveryConfig,
  type SubtypeDiscoveryJobPayload,
  type SubtypeDiscoveryJobResult,
  type SubtypeDiscoveryPreparedEmail,
  type SubtypeDiscoveryProgress,
  type SubtypeDiscoveryRecommendation,
  type SubtypeDiscoverySummary,
} from "@forgeops/shared";

const MAX_CLUSTERS_TO_INTERPRET = 20;
const EMBED_CONCURRENCY_NOTE = "batched embeddings (64)";

export async function processSubtypeDiscoveryRun(
  payload: SubtypeDiscoveryJobPayload,
  deps: {
    prisma: PrismaClient;
    openaiApiKey?: string;
    interpretModel?: string;
  }
): Promise<SubtypeDiscoveryJobResult> {
  const started = Date.now();
  const run = await deps.prisma.subtypeDiscoveryRun.findFirst({
    where: { id: payload.runId, workspaceId: payload.workspaceId },
  });
  if (!run) {
    return { runId: payload.runId, status: "FAILED", recommendationCount: 0 };
  }
  if (run.status === "CANCELLED" || run.status === "CANCELLING") {
    await markCancelled(deps.prisma, run.id);
    return { runId: run.id, status: "CANCELLED", recommendationCount: 0 };
  }

  const config = run.config as unknown as SubtypeDiscoveryConfig;
  const versions = subtypeDiscoveryAlgorithmVersions(
    deps.interpretModel ? { interpretModel: deps.interpretModel } : undefined
  );

  const apiKey = normalizeOpenAiApiKey(deps.openaiApiKey);
  const client = createOpenAIClient(apiKey ? { apiKey } : {});
  if (!client) {
    await failRun(
      deps.prisma,
      run.id,
      "OpenAI API key is not configured — cannot embed or interpret clusters."
    );
    return { runId: run.id, status: "FAILED", recommendationCount: 0 };
  }

  await deps.prisma.subtypeDiscoveryRun.update({
    where: { id: run.id },
    data: {
      status: "RUNNING",
      startedAt: run.startedAt ?? new Date(),
      algorithmVersions: versions as unknown as Prisma.InputJsonValue,
      progress: {
        ...emptySubtypeDiscoveryProgress(),
        phase: "SAMPLING",
        message: "Loading eligible emails",
      } satisfies SubtypeDiscoveryProgress as unknown as Prisma.InputJsonValue,
      errorMessage: null,
    },
  });

  try {
    if (await isCancelling(deps.prisma, run.id)) {
      await markCancelled(deps.prisma, run.id);
      return { runId: run.id, status: "CANCELLED", recommendationCount: 0 };
    }

    const where = buildEligibleWhere(payload.workspaceId, config);
    const candidates = await deps.prisma.emailMessage.findMany({
      where,
      select: {
        id: true,
        receivedAt: true,
        inboxConnectionId: true,
      },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      take: 50_000,
    });

    const { requested } = resolveRequestedSampleSize(config, candidates.length);
    const plan = sampleEmailsDeterministic(
      candidates.map((c) => ({
        id: c.id,
        receivedAt: c.receivedAt,
        inboxConnectionId: c.inboxConnectionId,
      })),
      requested
    );

    await updateProgress(deps.prisma, run.id, {
      phase: "PREPARING",
      emailsEligible: plan.eligibleCount,
      emailsSelected: plan.selectedIds.length,
      emailsPrepared: 0,
      emailsEmbedded: 0,
      clustersFound: 0,
      clustersInterpreted: 0,
      message: `Sampled ${plan.selectedIds.length} of ${plan.eligibleCount} (${plan.samplingMethod})`,
    });

    await deps.prisma.subtypeDiscoveryRun.update({
      where: { id: run.id },
      data: {
        sampledEmailIds: plan.selectedIds as unknown as Prisma.InputJsonValue,
      },
    });

    if (await isCancelling(deps.prisma, run.id)) {
      await markCancelled(deps.prisma, run.id);
      return { runId: run.id, status: "CANCELLED", recommendationCount: 0 };
    }

    const messages = await deps.prisma.emailMessage.findMany({
      where: {
        workspaceId: payload.workspaceId,
        id: { in: plan.selectedIds },
      },
      select: {
        id: true,
        subject: true,
        bodyText: true,
        snippet: true,
        mailboxCategory: true,
        inboxConnectionId: true,
        receivedAt: true,
        normalizedEmail: { select: { cleanTextBody: true } },
        classifications: { select: { businessTypeKey: true }, take: 1 },
      },
    });

    const { prepared, excludedIds } = prepareEmailsForDiscovery(
      messages.map((m) => ({
        emailMessageId: m.id,
        subject: m.subject,
        bodyText: m.bodyText,
        cleanTextBody: m.normalizedEmail?.cleanTextBody ?? null,
        snippet: m.snippet,
        mailboxCategory: m.mailboxCategory,
        businessTypeKey: m.classifications[0]?.businessTypeKey ?? null,
        inboxConnectionId: m.inboxConnectionId,
        receivedAt: m.receivedAt,
      }))
    );

    await updateProgress(deps.prisma, run.id, {
      phase: "EMBEDDING",
      emailsEligible: plan.eligibleCount,
      emailsSelected: plan.selectedIds.length,
      emailsPrepared: prepared.length,
      emailsEmbedded: 0,
      clustersFound: 0,
      clustersInterpreted: 0,
      message: `Prepared ${prepared.length}; excluded ${excludedIds.length}; embedding (${EMBED_CONCURRENCY_NOTE})`,
    });

    if (prepared.length === 0) {
      const summary = buildSummary({
        eligible: plan.eligibleCount,
        selected: plan.selectedIds.length,
        prepared: 0,
        excluded: excludedIds.length,
        analyzed: 0,
        clusters: 0,
        recommendations: [],
        unresolved: 0,
        durationMs: Date.now() - started,
        samplingMethod: plan.samplingMethod,
        versions,
      });
      await completeRun(deps.prisma, run.id, summary, []);
      return { runId: run.id, status: "COMPLETED", recommendationCount: 0 };
    }

    if (await isCancelling(deps.prisma, run.id)) {
      await markCancelled(deps.prisma, run.id);
      return { runId: run.id, status: "CANCELLED", recommendationCount: 0 };
    }

    const embeddings = await embedTextsForSubtypeDiscovery(
      client,
      prepared.map((p) => p.analysisText),
      {
        model: versions.embeddingModel,
        onBatch: async (done, total) => {
          await updateProgress(deps.prisma, run.id, {
            phase: "EMBEDDING",
            emailsEligible: plan.eligibleCount,
            emailsSelected: plan.selectedIds.length,
            emailsPrepared: prepared.length,
            emailsEmbedded: done,
            clustersFound: 0,
            clustersInterpreted: 0,
            message: `Embedded ${done}/${total}`,
          });
        },
      }
    );

    await updateProgress(deps.prisma, run.id, {
      phase: "CLUSTERING",
      emailsEligible: plan.eligibleCount,
      emailsSelected: plan.selectedIds.length,
      emailsPrepared: prepared.length,
      emailsEmbedded: prepared.length,
      clustersFound: 0,
      clustersInterpreted: 0,
      message: "Clustering embeddings",
    });

    const minClusterSize =
      prepared.length >= 500 ? 5 : prepared.length >= 100 ? 4 : 3;
    const { clusters, unresolvedIds } = clusterByCosineConnectedComponents(
      prepared.map((p, i) => ({
        id: p.emailMessageId,
        embedding: embeddings[i] ?? [],
      })),
      { minClusterSize, similarityThreshold: 0.78, maxPairwiseN: 800 }
    );

    const preparedById = new Map(prepared.map((p) => [p.emailMessageId, p]));
    const toInterpret = clusters
      .slice()
      .sort(
        (a, b) =>
          b.emailMessageIds.length - a.emailMessageIds.length ||
          a.clusterId.localeCompare(b.clusterId)
      )
      .slice(0, MAX_CLUSTERS_TO_INTERPRET);

    await updateProgress(deps.prisma, run.id, {
      phase: "INTERPRETING",
      emailsEligible: plan.eligibleCount,
      emailsSelected: plan.selectedIds.length,
      emailsPrepared: prepared.length,
      emailsEmbedded: prepared.length,
      clustersFound: clusters.length,
      clustersInterpreted: 0,
      message: `Interpreting ${toInterpret.length} of ${clusters.length} clusters`,
    });

    const recommendations: SubtypeDiscoveryRecommendation[] = [];
    for (let i = 0; i < toInterpret.length; i++) {
      if (await isCancelling(deps.prisma, run.id)) {
        await markCancelled(deps.prisma, run.id);
        return { runId: run.id, status: "CANCELLED", recommendationCount: 0 };
      }
      const cluster = toInterpret[i]!;
      const reps = cluster.representativeIds
        .map((id) => preparedById.get(id))
        .filter((p): p is SubtypeDiscoveryPreparedEmail => !!p);
      const memberKeys = cluster.emailMessageIds.map(
        (id) => preparedById.get(id)?.businessTypeKey ?? null
      );
      const overlap = existingSubtypeOverlap(memberKeys);

      let interpreted;
      try {
        interpreted = await interpretDiscoveryCluster(
          client,
          {
            cluster,
            representatives: reps,
            memberSubtypeKeys: memberKeys,
            analyzedCount: prepared.length,
          },
          { model: versions.interpretModel }
        );
      } catch (e) {
        interpreted = {
          kind: "UNCLEAR" as const,
          suggestedSubtypeName: null,
          recommendedParentType: "BUSINESS" as const,
          definition: null,
          inclusionCriteria: null,
          exclusionCriteria: null,
          similarExistingKeys: overlap.topKeys,
          overlapNotes: null,
          rationale:
            e instanceof Error
              ? `Interpretation failed: ${e.message.slice(0, 200)}`
              : "Interpretation failed",
          commonIntent: null,
        };
      }

      const compared = classifyClusterAgainstTaxonomy({
        suggestedName: interpreted.suggestedSubtypeName,
        similarExistingKeys:
          interpreted.similarExistingKeys.length > 0
            ? interpreted.similarExistingKeys
            : overlap.topKeys,
        dominantExistingShare: overlap.dominantShare,
        clusterSize: cluster.emailMessageIds.length,
        analyzedCount: prepared.length,
        clusterCohesion: cluster.meanInternalSimilarity,
        llmKind: interpreted.kind,
      });

      const examples = reps.map((r) => ({
        emailMessageId: r.emailMessageId,
        subject: r.subject,
        snippet: r.analysisText.slice(0, 240),
        mailboxCategory: r.mailboxCategory,
        businessTypeKey: r.businessTypeKey,
      }));

      recommendations.push({
        id: `${cluster.clusterId}-${compared.kind.toLowerCase()}`,
        clusterId: cluster.clusterId,
        kind: compared.kind,
        suggestedSubtypeName: interpreted.suggestedSubtypeName,
        recommendedParentType: interpreted.recommendedParentType,
        definition: interpreted.definition,
        inclusionCriteria: interpreted.inclusionCriteria,
        exclusionCriteria: interpreted.exclusionCriteria,
        supportingEmailCount: cluster.emailMessageIds.length,
        shareOfAnalyzed:
          prepared.length > 0
            ? Math.round(
                (cluster.emailMessageIds.length / prepared.length) * 10000
              ) / 10000
            : 0,
        similarExistingSubtypes: compared.similarExistingSubtypes,
        overlapNotes: interpreted.overlapNotes,
        rationale: [compared.rationalePrefix, interpreted.rationale]
          .filter(Boolean)
          .join(" "),
        examples,
        supportingEmailIds: cluster.emailMessageIds.slice(0, 100),
        clusterCohesion: cluster.meanInternalSimilarity,
      });

      await updateProgress(deps.prisma, run.id, {
        phase: "INTERPRETING",
        emailsEligible: plan.eligibleCount,
        emailsSelected: plan.selectedIds.length,
        emailsPrepared: prepared.length,
        emailsEmbedded: prepared.length,
        clustersFound: clusters.length,
        clustersInterpreted: i + 1,
        message: `Interpreted ${i + 1}/${toInterpret.length}`,
      });
    }

    // Clusters not interpreted still count as unresolved for summary
    const unresolved =
      unresolvedIds.length + Math.max(0, clusters.length - toInterpret.length);

    const summary = buildSummary({
      eligible: plan.eligibleCount,
      selected: plan.selectedIds.length,
      prepared: prepared.length,
      excluded: excludedIds.length,
      analyzed: prepared.length,
      clusters: clusters.length,
      recommendations,
      unresolved,
      durationMs: Date.now() - started,
      samplingMethod: plan.samplingMethod,
      versions,
    });

    await updateProgress(deps.prisma, run.id, {
      phase: "PERSISTING",
      emailsEligible: plan.eligibleCount,
      emailsSelected: plan.selectedIds.length,
      emailsPrepared: prepared.length,
      emailsEmbedded: prepared.length,
      clustersFound: clusters.length,
      clustersInterpreted: toInterpret.length,
      message: "Saving results",
    });

    await completeRun(deps.prisma, run.id, summary, recommendations);
    return {
      runId: run.id,
      status: "COMPLETED",
      recommendationCount: recommendations.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 480) : "Discovery failed";
    await failRun(deps.prisma, run.id, msg);
    return { runId: run.id, status: "FAILED", recommendationCount: 0 };
  }
}

function buildEligibleWhere(
  workspaceId: string,
  config: SubtypeDiscoveryConfig
): Prisma.EmailMessageWhereInput {
  const where: Prisma.EmailMessageWhereInput = {
    workspaceId,
  };
  if (config.mailboxCategory === "BUSINESS") {
    where.mailboxCategory = "BUSINESS";
  } else if (config.mailboxCategory === "PERSONAL") {
    where.mailboxCategory = "PERSONAL";
  }
  if (config.inboxConnectionId) {
    where.inboxConnectionId = config.inboxConnectionId;
  }
  if (config.receivedAfter || config.receivedBefore) {
    where.receivedAt = {};
    if (config.receivedAfter) {
      where.receivedAt.gte = new Date(config.receivedAfter);
    }
    if (config.receivedBefore) {
      where.receivedAt.lte = new Date(config.receivedBefore);
    }
  }
  return where;
}

function buildSummary(input: {
  eligible: number;
  selected: number;
  prepared: number;
  excluded: number;
  analyzed: number;
  clusters: number;
  recommendations: SubtypeDiscoveryRecommendation[];
  unresolved: number;
  durationMs: number;
  samplingMethod: string;
  versions: ReturnType<typeof subtypeDiscoveryAlgorithmVersions>;
}): SubtypeDiscoverySummary {
  const countKind = (k: SubtypeDiscoveryRecommendation["kind"]) =>
    input.recommendations.filter((r) => r.kind === k).length;
  return {
    emailsEligible: input.eligible,
    emailsSelected: input.selected,
    emailsPrepared: input.prepared,
    emailsExcluded: input.excluded,
    emailsAnalyzed: input.analyzed,
    clustersDiscovered: input.clusters,
    proposedNewSubtypes: countKind("NEW_SUBTYPE"),
    existingSubtypeMatches: countKind("EXISTING_MATCH"),
    refinements: countKind("REFINEMENT"),
    mergeCandidates: countKind("MERGE_CANDIDATE"),
    unresolvedClusters: input.unresolved + countKind("UNCLEAR"),
    durationMs: input.durationMs,
    samplingMethod: input.samplingMethod,
    embeddingModel: input.versions.embeddingModel,
    interpretModel: input.versions.interpretModel,
    clusterAlgorithm: input.versions.clusterAlgorithm,
    pipelineVersion: input.versions.pipelineVersion,
  };
}

async function updateProgress(
  prisma: PrismaClient,
  runId: string,
  progress: SubtypeDiscoveryProgress
): Promise<void> {
  await prisma.subtypeDiscoveryRun.update({
    where: { id: runId },
    data: { progress: progress as unknown as Prisma.InputJsonValue },
  });
}

async function isCancelling(prisma: PrismaClient, runId: string): Promise<boolean> {
  const row = await prisma.subtypeDiscoveryRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  return row?.status === "CANCELLING" || row?.status === "CANCELLED";
}

async function markCancelled(prisma: PrismaClient, runId: string): Promise<void> {
  await prisma.subtypeDiscoveryRun.updateMany({
    where: { id: runId, status: { in: ["PENDING", "RUNNING", "CANCELLING"] } },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
      progress: {
        ...emptySubtypeDiscoveryProgress(),
        phase: "CANCELLED",
        message: "Cancelled",
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

async function failRun(
  prisma: PrismaClient,
  runId: string,
  errorMessage: string
): Promise<void> {
  await prisma.subtypeDiscoveryRun.updateMany({
    where: { id: runId, status: { in: ["PENDING", "RUNNING", "CANCELLING"] } },
    data: {
      status: "FAILED",
      errorMessage,
      completedAt: new Date(),
      progress: {
        ...emptySubtypeDiscoveryProgress(),
        phase: "FAILED",
        message: errorMessage.slice(0, 200),
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

async function completeRun(
  prisma: PrismaClient,
  runId: string,
  summary: SubtypeDiscoverySummary,
  recommendations: SubtypeDiscoveryRecommendation[]
): Promise<void> {
  await prisma.subtypeDiscoveryRun.update({
    where: { id: runId },
    data: {
      status: "COMPLETED",
      summary: summary as unknown as Prisma.InputJsonValue,
      recommendations: recommendations as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
      progress: {
        phase: "DONE",
        emailsEligible: summary.emailsEligible,
        emailsSelected: summary.emailsSelected,
        emailsPrepared: summary.emailsPrepared,
        emailsEmbedded: summary.emailsAnalyzed,
        clustersFound: summary.clustersDiscovered,
        clustersInterpreted: recommendations.length,
        message: "Completed",
      } satisfies SubtypeDiscoveryProgress as unknown as Prisma.InputJsonValue,
    },
  });
}
