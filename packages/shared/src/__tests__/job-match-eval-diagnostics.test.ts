import { describe, expect, it } from "vitest";
import {
  buildEvalRowDiagnostics,
  buildJobMatcherEvalDetailedCsv,
  buildJobMatcherEvalDiagnostics,
  failureCategoryForWrongRow,
  projectIdentityFamilyForEvidenceType,
  type EvalDiagRowInput,
} from "../jobs/job-match-eval-diagnostics.js";

function baseRow(over: Partial<EvalDiagRowInput> = {}): EvalDiagRowInput {
  return {
    emailMessageId: "e1",
    subject: "Re: Beltline",
    direction: "RECEIVED",
    trueJobId: "job_true",
    trueJobName: "Exodus",
    trueJobNumber: "100",
    jobAssignmentSource: "USER_ASSIGNED",
    predictedJobId: "job_pred",
    predictedJobName: "Beltline Bldg #3",
    predictedJobNumber: "200",
    decision: "MATCH",
    outcome: "WRONG_MATCH",
    resolvingMarker: "NAME",
    evidence: [{ type: "SUBJECT_JOB_ALIAS", value: "beltline" }],
    markerTrace: [
      {
        marker: "NAME",
        status: "MATCH",
        candidateJobIds: ["job_pred"],
        candidateJobNames: ["Beltline Bldg #3"],
      },
    ],
    ...over,
  };
}

describe("job-match-eval-diagnostics", () => {
  it("maps project identity evidence families from canonical types", () => {
    expect(projectIdentityFamilyForEvidenceType("SUBJECT_JOB_NAME")).toBe("JOB_NAME");
    expect(projectIdentityFamilyForEvidenceType("CONTENT_JOB_ALIAS")).toBe("ENTITY_ALIAS");
    expect(projectIdentityFamilyForEvidenceType("SUBJECT_JOB_SITE")).toBe("SITE_NAME");
    expect(projectIdentityFamilyForEvidenceType("CONTENT_JOB_EXTERNAL_REF")).toBe(
      "EXTERNAL_REF"
    );
    expect(projectIdentityFamilyForEvidenceType("SENDER_JOB_CONTACT")).toBeNull();
  });

  it("attributes NAME-resolved wrong match to PROJECT_IDENTITY + alias subcategory", () => {
    const row = baseRow();
    const d = buildEvalRowDiagnostics(row);
    expect(d.failureCategory).toBe("PROJECT_IDENTITY");
    expect(d.failureSubcategory).toBe("ENTITY_ALIAS");
    expect(d.resolvingMarker).toBe("NAME");
    expect(d.groundTruthSurvivedMarker1).toBe(false);
    expect(d.firstGroundTruthLossStage).toBe("NAME");
  });

  it("attributes CONTACT-resolved wrong match to CONTACT", () => {
    const row = baseRow({
      resolvingMarker: "CONTACT",
      evidence: [{ type: "SENDER_JOB_CONTACT", value: "a@x.com" }],
      markerTrace: [
        {
          marker: "NAME",
          status: "AMBIGUOUS",
          candidateJobIds: ["job_true", "job_pred"],
          candidateJobNames: ["Exodus", "Beltline"],
        },
        {
          marker: "CONTACT",
          status: "MATCH",
          candidateJobIds: ["job_pred"],
          candidateJobNames: ["Beltline"],
        },
      ],
    });
    const d = buildEvalRowDiagnostics(row);
    expect(failureCategoryForWrongRow(row, d.contributingMarkers)).toBe(
      "MULTI_MARKER_INTERACTION"
    );
    expect(d.contributingMarkers).toContain("NAME");
    expect(d.contributingMarkers).toContain("CONTACT");
    expect(d.groundTruthSurvivedMarker1).toBe(true);
    expect(d.groundTruthSurvivedMarker2).toBe(false);
    expect(d.firstGroundTruthLossStage).toBe("CONTACT");
  });

  it("attributes THREAD-only resolution without multi-marker", () => {
    const row = baseRow({
      resolvingMarker: "THREAD",
      evidence: [{ type: "THREAD_JOB_AUTHORITATIVE", value: "thread-1" }],
      markerTrace: [
        {
          marker: "THREAD",
          status: "MATCH",
          candidateJobIds: ["job_pred"],
          candidateJobNames: ["Beltline"],
        },
      ],
    });
    const d = buildEvalRowDiagnostics(row);
    expect(d.failureCategory).toBe("THREAD");
    expect(d.resolvingMarker).toBe("THREAD");
  });

  it("aggregates wrong-by-category and marker precision", () => {
    const correct = baseRow({
      emailMessageId: "ok",
      outcome: "CORRECT_MATCH",
      predictedJobId: "job_true",
      predictedJobName: "Exodus",
      evidence: [{ type: "SUBJECT_JOB_NAME", value: "Exodus" }],
      markerTrace: [
        {
          marker: "NAME",
          status: "MATCH",
          candidateJobIds: ["job_true"],
          candidateJobNames: ["Exodus"],
        },
      ],
    });
    const wrongName = baseRow({ emailMessageId: "w1" });
    const wrongContact = baseRow({
      emailMessageId: "w2",
      resolvingMarker: "CONTACT",
      evidence: [{ type: "SENDER_JOB_CONTACT", value: "a@x.com" }],
      markerTrace: [
        {
          marker: "CONTACT",
          status: "MATCH",
          candidateJobIds: ["job_pred"],
          candidateJobNames: ["Beltline"],
        },
      ],
    });
    const { diagnostics } = buildJobMatcherEvalDiagnostics([
      correct,
      wrongName,
      wrongContact,
    ]);
    expect(diagnostics.wrongMatchCount).toBe(2);
    const namePerf = diagnostics.markerPerformance.find((m) => m.marker === "NAME");
    expect(namePerf?.correct).toBe(1);
    expect(namePerf?.wrong).toBe(1);
    expect(namePerf?.precision).toBe(0.5);
    expect(diagnostics.commonConfusions[0]?.count).toBeGreaterThanOrEqual(1);
  });

  it("detailed CSV excludes email bodies and includes failure columns", () => {
    const row = baseRow();
    const { rowDiagnostics } = buildJobMatcherEvalDiagnostics([row]);
    const csv = buildJobMatcherEvalDetailedCsv([row], rowDiagnostics);
    expect(csv).toContain("failure_category");
    expect(csv).toContain("PROJECT_IDENTITY");
    expect(csv).not.toContain("bodyHtml");
    expect(csv).not.toContain("<html");
  });

  it("correct match is not assigned a failure category", () => {
    const row = baseRow({
      outcome: "CORRECT_MATCH",
      predictedJobId: "job_true",
      predictedJobName: "Exodus",
      markerTrace: [
        {
          marker: "NAME",
          status: "MATCH",
          candidateJobIds: ["job_true"],
          candidateJobNames: ["Exodus"],
        },
      ],
    });
    expect(buildEvalRowDiagnostics(row).failureCategory).toBeNull();
  });
});
