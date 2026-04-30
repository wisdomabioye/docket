import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { caseParticipants, cases, users } from "@/server/db/schema";
import { AppError } from "@/lib/errors";
import { OUTPUT_TYPE_DISPLAY, readRecommenderName } from "@/lib/output-types";
import type { OutputType } from "@/server/services/computer/types";
import { getCurrentOutputs } from "@/server/services/output";
import {
  PackagePdfDocument,
  PerOutputPdfDocument,
  packageKeyFor,
  packageOrderRank,
  renderOutputBody,
  type OutputBodyDescriptor,
} from "./package";
import {
  DEFAULT_PDF_URL_TTL_SECONDS,
  packagePdfKey,
  perOutputPdfKey,
  renderAndStorePdf,
} from "./render";

/**
 * Stage 08 PDF compile flows.
 *
 *   - `renderPerOutputPdf({ db, caseId, outputId })` — single-output
 *     PDF for the "Download PDF" button on each output detail page.
 *   - `compileFullPackagePdf({ db, caseId })` — bundle PDF for the
 *     "Download package" button. Loads every approved current output,
 *     sorts by canonical filing order, renders.
 *
 * Both flows produce a 10-minute signed download URL via the storage
 * abstraction. PDFs are NOT persisted across downloads — every click
 * re-renders to pick up the latest content (spec lock).
 */

type CoverFields = {
  beneficiaryName: string;
  visaType: string;
  attorneyName: string;
  generatedDateLabel: string;
  /** Attorney's persisted package order (`outputType:subgroupKey`
   *  keys). Null when never set — the package compiler falls back to
   *  the canonical `packageOrderRank` rank. */
  packageOrder: ReadonlyArray<string> | null;
};

async function loadCoverFields(args: {
  db: Db;
  caseId: string;
}): Promise<CoverFields> {
  const [row] = await args.db
    .select({
      visaType: cases.visaType,
      beneficiaryData: cases.beneficiaryData,
      packageOrder: cases.packageOrder,
    })
    .from(cases)
    .where(and(eq(cases.id, args.caseId), isNull(cases.deletedAt)))
    .limit(1);
  if (!row) {
    throw new AppError("NOT_FOUND", `case ${args.caseId} not found`);
  }
  // Primary attorney = the participant flagged is_primary on this case.
  // Fallback "Attorney" string when no participant row exists (rare —
  // case.create always inserts one).
  const [primary] = await args.db
    .select({ name: users.name })
    .from(caseParticipants)
    .innerJoin(users, eq(users.id, caseParticipants.userId))
    .where(
      and(
        eq(caseParticipants.caseId, args.caseId),
        eq(caseParticipants.isPrimary, true),
        isNull(caseParticipants.removedAt),
      ),
    )
    .limit(1);
  const beneficiaryName = row.beneficiaryData?.fullName?.trim() ?? "Beneficiary";
  return {
    beneficiaryName,
    visaType: row.visaType,
    attorneyName: primary?.name ?? "Attorney",
    generatedDateLabel: new Date().toISOString().slice(0, 10),
    packageOrder: row.packageOrder ?? null,
  };
}

function bodyDescriptorFor(args: {
  outputType: OutputType;
  content: string;
  metadata: unknown;
  beneficiaryName: string;
  visaType: string;
}): OutputBodyDescriptor {
  if (args.outputType === "exhibit_index") {
    const exhibitCount = readExhibitCount(args.metadata);
    return {
      kind: "exhibit-index",
      beneficiaryName: args.beneficiaryName,
      visaType: args.visaType,
      content: args.content,
      exhibitCount,
    };
  }
  // Recommendation letters get a per-recommender subtitle from
  // metadata so each letter is self-identifying in the package.
  if (args.outputType === "recommendation_letter_template") {
    const recommenderName = readRecommenderName({
      outputType: args.outputType,
      metadata: args.metadata,
    });
    return {
      kind: "prose",
      runningHeading: OUTPUT_TYPE_DISPLAY[args.outputType],
      ...(recommenderName ? { subtitle: `Letter for ${recommenderName}` } : {}),
      content: args.content,
    };
  }
  return {
    kind: "prose",
    runningHeading: OUTPUT_TYPE_DISPLAY[args.outputType],
    content: args.content,
  };
}

function readExhibitCount(metadata: unknown): number | null {
  if (
    metadata !== null &&
    typeof metadata === "object" &&
    "exhibitCount" in metadata
  ) {
    const v = (metadata as { exhibitCount?: unknown }).exhibitCount;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}

export type RenderPerOutputPdfArgs = {
  db: Db;
  caseId: string;
  /** The CURRENT output row id. Older versions can't be downloaded
   *  directly — Stage 08's UI only exposes the current row. Restore the
   *  version first to download a prior draft. */
  outputId: string;
  expiresInSeconds?: number;
};

export type RenderPerOutputPdfResult = {
  url: string;
  key: string;
  bytes: number;
};

export async function renderPerOutputPdf(
  args: RenderPerOutputPdfArgs,
): Promise<RenderPerOutputPdfResult> {
  const cover = await loadCoverFields({ db: args.db, caseId: args.caseId });

  const outputs = await getCurrentOutputs({ db: args.db, caseId: args.caseId });
  const target = outputs.find((o) => o.id === args.outputId);
  if (!target) {
    throw new AppError(
      "NOT_FOUND",
      `output ${args.outputId} not found among current outputs for case ${args.caseId}`,
    );
  }
  if (!target.content || target.content.trim().length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "Cannot download a PDF for an empty-content output.",
    );
  }

  const body = bodyDescriptorFor({
    outputType: target.outputType,
    content: target.content,
    metadata: target.metadata,
    beneficiaryName: cover.beneficiaryName,
    visaType: cover.visaType,
  });

  const timestampMs = Date.now();
  const result = await renderAndStorePdf({
    element: (
      <PerOutputPdfDocument
        cover={{
          title: OUTPUT_TYPE_DISPLAY[target.outputType],
          ...cover,
        }}
        body={renderOutputBody(body, "body")}
      />
    ),
    key: perOutputPdfKey({
      caseId: args.caseId,
      outputId: args.outputId,
      timestampMs,
    }),
    ...(args.expiresInSeconds !== undefined
      ? { expiresInSeconds: args.expiresInSeconds }
      : { expiresInSeconds: DEFAULT_PDF_URL_TTL_SECONDS }),
  });
  return result;
}

export type CompileFullPackagePdfArgs = {
  db: Db;
  caseId: string;
  expiresInSeconds?: number;
};

export type CompileFullPackagePdfResult = RenderPerOutputPdfResult;

export async function compileFullPackagePdf(
  args: CompileFullPackagePdfArgs,
): Promise<CompileFullPackagePdfResult> {
  const cover = await loadCoverFields({ db: args.db, caseId: args.caseId });

  // Load every approved + current output. We don't filter at the SQL
  // level here because `getCurrentOutputs` is the single read path and
  // returning all current rows lets the UI's "what's included" preview
  // share the same query.
  const allCurrent = await getCurrentOutputs({
    db: args.db,
    caseId: args.caseId,
  });
  const approved = allCurrent.filter(
    (o) => o.attorneyApproved && o.content && o.content.trim().length > 0,
  );
  if (approved.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "Approve at least one output before downloading the package.",
    );
  }

  // Order resolution:
  //   1. If the attorney persisted a custom order (Stage 11 γ DnD),
  //      sort by index in `cases.package_order`. Rows whose key is
  //      missing from the saved array (e.g. a regenerate produced a
  //      new subgroup after the order was saved) fall through to the
  //      canonical rank — they won't silently disappear.
  //   2. Otherwise use `packageOrderRank` + subgroup tiebreaker so
  //      two consecutive package downloads stay deterministic.
  const savedOrder = cover.packageOrder;
  const savedIndex = (key: string): number => {
    if (!savedOrder) return -1;
    return savedOrder.indexOf(key);
  };
  const sorted = [...approved].sort((a, b) => {
    const aKey = packageKeyFor({
      outputType: a.outputType,
      subgroupKey: a.subgroupKey,
    });
    const bKey = packageKeyFor({
      outputType: b.outputType,
      subgroupKey: b.subgroupKey,
    });
    if (savedOrder) {
      const ai = savedIndex(aKey);
      const bi = savedIndex(bKey);
      // Both present → saved order wins.
      if (ai !== -1 && bi !== -1) return ai - bi;
      // One present, one new → present row sorts first.
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      // Fallthrough: neither in saved order — use canonical rank.
    }
    const r = packageOrderRank(a.outputType) - packageOrderRank(b.outputType);
    if (r !== 0) return r;
    return (a.subgroupKey ?? "").localeCompare(b.subgroupKey ?? "");
  });

  const bodies = sorted.map((o) => ({
    key: o.id,
    body: bodyDescriptorFor({
      outputType: o.outputType,
      content: o.content ?? "",
      metadata: o.metadata,
      beneficiaryName: cover.beneficiaryName,
      visaType: cover.visaType,
    }),
  }));

  const timestampMs = Date.now();
  const result = await renderAndStorePdf({
    element: (
      <PackagePdfDocument
        cover={{ title: "Filing Package", ...cover }}
        bodies={bodies}
      />
    ),
    key: packagePdfKey({ caseId: args.caseId, timestampMs }),
    ...(args.expiresInSeconds !== undefined
      ? { expiresInSeconds: args.expiresInSeconds }
      : { expiresInSeconds: DEFAULT_PDF_URL_TTL_SECONDS }),
  });
  return result;
}

// Re-export render-layer helpers so the tRPC layer needs only one
// import. Keeps the module surface tidy.
export {
  DEFAULT_PDF_URL_TTL_SECONDS,
  renderAndStorePdf,
  renderPdfToBuffer,
  uploadPdfAndSign,
} from "./render";

