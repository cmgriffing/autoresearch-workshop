import { z } from "zod";

export const DEFAULT_MAX_LOG_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_DOCUMENT_BYTES = 1024 * 1024;
export const DEFAULT_RESCAN_INTERVAL_MS = 5_000;
export const DEFAULT_EXCLUDED_DIRECTORIES = [
  "node_modules",
  ".git",
  ".turbo",
  ".cache",
  "dist",
  "build",
];
export const VisualizerConfigSchema = z.strictObject({
  roots: z
    .array(
      z.strictObject({
        path: z.string().trim().min(1),
        recursive: z.boolean().default(true),
      }),
    )
    .min(1),
  exclude: z
    .array(
      z
        .string()
        .min(1)
        .refine(
          (name) => name !== "." && name !== ".." && !/[\\/]/.test(name),
          "Exclusions must be directory basenames, not paths.",
        ),
    )
    .default(DEFAULT_EXCLUDED_DIRECTORIES),
  minWinImprovementPct: z.number().nonnegative().default(0),
  maxLogBytes: z.number().int().positive().default(DEFAULT_MAX_LOG_BYTES),
  maxDocumentBytes: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_MAX_DOCUMENT_BYTES),
  watch: z.boolean().default(true),
  rescanIntervalMs: z
    .number()
    .int()
    .positive()
    .max(2_147_483_647)
    .default(DEFAULT_RESCAN_INTERVAL_MS),
});
export type VisualizerConfig = z.infer<typeof VisualizerConfigSchema>;

export const DiagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  sourceLine: z.number().int().positive().optional(),
  rootId: z.string().optional(),
  directory: z.string().optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export const RootSummarySchema = z.object({
  id: z.string().min(1),
  path: z.string(),
  canonicalPath: z.string().optional(),
  recursive: z.boolean(),
  state: z.enum(["available", "error"]),
  diagnostics: z.array(DiagnosticSchema),
});
export type RootSummary = z.infer<typeof RootSummarySchema>;
export const RootAssociationSchema = z.object({
  rootId: z.string().min(1),
  relativePath: z.string(),
});
export type RootAssociation = z.infer<typeof RootAssociationSchema>;
export const MetricConfigSchema = z.object({
  name: z.string().min(1),
  metricName: z.string().min(1),
  metricUnit: z.string(),
  bestDirection: z.enum(["lower", "higher"]),
});
export type MetricConfig = z.infer<typeof MetricConfigSchema>;
export const ConfigRecordSchema = z.object({
  type: z.literal("config"),
  name: z.string().min(1).optional(),
  metricName: z.string().min(1).optional(),
  metricUnit: z.string().optional(),
  bestDirection: z.enum(["lower", "higher"]).optional(),
});
export const RunRecordSchema = z.object({
  run: z.number().int().positive(),
  metric: z.number(),
  status: z.enum(["keep", "discard", "crash", "checks_failed"]),
  description: z.string().default(""),
  commit: z.string().optional(),
  // Milliseconds since the Unix epoch, within the JavaScript Date range.
  timestamp: z
    .number()
    .nonnegative()
    .max(8_640_000_000_000_000)
    .nullable()
    .optional(),
  metrics: z.record(z.string(), z.number()).optional(),
  confidence: z.number().nullable().optional(),
  asi: z.json().optional(),
});
export const RunSnapshotSchema = RunRecordSchema.extend({
  id: z.string().min(1),
  sourceLine: z.number().int().positive(),
  segmentId: z.string().min(1),
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;
export const ImprovementSchema = z.object({
  reference: z.number(),
  absolute: z.number(),
  percentage: z.number().nullable(),
});
export type Improvement = z.infer<typeof ImprovementSchema>;
export const WinSummarySchema = z.object({
  runId: z.string().min(1),
  previousBestMetric: z.number(),
  incremental: ImprovementSchema,
  cumulative: ImprovementSchema,
});
export type WinSummary = z.infer<typeof WinSummarySchema>;
export const AttemptPlotPointSchema = z.object({
  runId: z.string().min(1),
  // One-based position in the segment's valid source records, not display run.
  attempt: z.number().int().positive(),
  run: z.number().int().positive(),
  sourceLine: z.number().int().positive(),
  status: RunRecordSchema.shape.status,
  // Failed runs retain their recorded metric on the run, but never on the axis.
  metric: z.number().nullable(),
  bestMetric: z.number().nullable(),
  bestRunId: z.string().min(1).nullable(),
  isBaseline: z.boolean(),
  isWin: z.boolean(),
});
export type AttemptPlotPoint = z.infer<typeof AttemptPlotPointSchema>;
export const SegmentSnapshotSchema = MetricConfigSchema.extend({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  metadataSource: z.enum(["header", "fallback"]),
  defaultedFields: z.array(
    z.enum(["name", "metricName", "metricUnit", "bestDirection"]),
  ),
  runIds: z.array(z.string().min(1)),
  baselineRunId: z.string().min(1).nullable(),
  bestRunId: z.string().min(1).nullable(),
  baselineMetric: z.number().nullable(),
  bestMetric: z.number().nullable(),
  cumulativeImprovement: ImprovementSchema.nullable(),
  wins: z.array(WinSummarySchema),
  attempts: z.array(AttemptPlotPointSchema),
});
export type SegmentSnapshot = z.infer<typeof SegmentSnapshotSchema>;
export const DocumentStateSchema = z.enum([
  "ready",
  "missing",
  "error",
  "limited",
]);
export const CurrentDocumentSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), content: z.string() }),
  z.object({
    state: z.enum(["missing", "error", "limited"]),
    content: z.null(),
    message: z.string().min(1),
  }),
]);
export type CurrentDocument = z.infer<typeof CurrentDocumentSchema>;
export const ProjectDocumentsSchema = z.object({
  ideas: CurrentDocumentSchema,
  prompt: CurrentDocumentSchema,
});
export type ProjectDocuments = z.infer<typeof ProjectDocumentsSchema>;
export const ProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  relativePath: z.string(),
  rootPath: z.string(),
  rootAssociations: z.array(RootAssociationSchema).min(1),
  revision: z.string(),
  sourceState: z.enum(["ready", "missing", "error", "limited"]),
  stale: z.boolean().default(false),
  documentStates: z.object({
    ideas: DocumentStateSchema,
    prompt: DocumentStateSchema,
  }),
  runCount: z.number().int().nonnegative(),
  diagnostics: z.array(DiagnosticSchema),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export const ProjectSnapshotSchema = z.object({
  project: ProjectSummarySchema,
  logRevision: z.string().min(1),
  documents: ProjectDocumentsSchema,
  metricConfig: MetricConfigSchema.nullable(),
  minWinImprovementPct: z.number().nonnegative(),
  segments: z.array(SegmentSnapshotSchema),
  runs: z.array(RunSnapshotSchema),
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
export const ProjectsResponseSchema = z.object({
  indexRevision: z.number().int().nonnegative(),
  watchEnabled: z.boolean(),
  minWinImprovementPct: z.number().nonnegative(),
  roots: z.array(RootSummarySchema),
  projects: z.array(ProjectSummarySchema),
  diagnostics: z.array(DiagnosticSchema),
});
export type ProjectsResponse = z.infer<typeof ProjectsResponseSchema>;
export const RefreshResponseSchema = z.object({
  indexRevision: z.number().int().positive(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;
export const ProjectInvalidationSchema = z.object({
  id: z.string().min(1),
  revision: z.string().min(1),
  stale: z.boolean(),
});
export const LiveEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("connected"),
    indexRevision: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("heartbeat"),
    indexRevision: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("invalidate"),
    reason: z.enum(["source-change", "manual-refresh", "discovery"]),
    indexRevision: z.number().int().positive(),
    projects: z.array(ProjectInvalidationSchema),
    removedProjectIds: z.array(z.string().min(1)),
  }),
]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const DiffReferenceSchema = z.object({
  kind: z.enum(["commit", "empty-tree"]),
  oid: z.string().regex(/^[0-9a-f]{40,64}$/),
});
export const DiffComparisonSchema = z.enum(["parent", "baseline"]);
export type DiffComparison = z.infer<typeof DiffComparisonSchema>;
export const ChangedFileSchema = z.object({
  path: z.string().min(1), // Repository-relative path; never accepted from clients.
  oldPath: z.string().min(1).nullable(),
  status: z.enum([
    "added",
    "deleted",
    "modified",
    "renamed",
    "copied",
    "type-changed",
  ]),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  binary: z.boolean(),
  patch: z.string().min(1),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;
const diffContext = {
  comparison: DiffComparisonSchema,
  includeAuto: z.boolean().default(false),
  base: DiffReferenceSchema.optional(),
  target: DiffReferenceSchema.optional(),
  targetParentCount: z.number().int().nonnegative().optional(),
  gitDirectoryKind: z.enum(["file", "directory"]).optional(),
};
const resolvedDiff = {
  ...diffContext,
  base: DiffReferenceSchema,
  target: DiffReferenceSchema,
  targetParentCount: z.number().int().nonnegative(),
  gitDirectoryKind: z.enum(["file", "directory"]),
};
export const DiffResponseSchema = z.discriminatedUnion("state", [
  z.object({
    ...resolvedDiff,
    state: z.literal("available"),
    patch: z.string().min(1),
    containsBinary: z.boolean(),
    files: z.array(ChangedFileSchema).min(1),
  }),
  z.object({
    ...resolvedDiff,
    state: z.literal("binary"),
    patch: z.string().min(1),
    containsBinary: z.literal(true),
    files: z.array(ChangedFileSchema).min(1),
    message: z.string(),
  }),
  z.object({
    ...resolvedDiff,
    state: z.literal("empty"),
    files: z.array(ChangedFileSchema).length(0),
    message: z.string(),
  }),
  z.object({
    ...diffContext,
    state: z.literal("missing"),
    reason: z.enum([
      "commit-not-recorded",
      "repository-unavailable",
      "commit-unavailable",
      "baseline-not-recorded",
      "baseline-commit-not-recorded",
      "baseline-unavailable",
    ]),
    recordedCommit: z.string().optional(),
    recordedBaseline: z.string().optional(),
    message: z.string(),
  }),
  z.object({
    ...diffContext,
    state: z.literal("invalid"),
    reason: z.enum(["commit-format", "commit-ambiguous"]),
    recordedCommit: z.string(),
    message: z.string(),
  }),
  z.object({
    ...diffContext,
    state: z.literal("limited"),
    reason: z.enum(["timeout", "output"]),
    message: z.string(),
  }),
  z.object({
    ...diffContext,
    state: z.literal("failure"),
    message: z.string(),
  }),
]);
export type DiffResponse = z.infer<typeof DiffResponseSchema>;

export type ParsedSegment = MetricConfig & {
  index: number;
  metadataSource: "header" | "fallback";
  defaultedFields: ("name" | "metricName" | "metricUnit" | "bestDirection")[];
};

const defaultSegment = (
  index: number,
  metadataSource: "header" | "fallback",
) => ({
  index,
  name: `Segment ${index + 1}`,
  metricName: "metric",
  metricUnit: "",
  bestDirection: "lower" as const,
  metadataSource,
  defaultedFields: [
    "name",
    "metricName",
    "metricUnit",
    "bestDirection",
  ] as ParsedSegment["defaultedFields"],
});

// Preserve source position/text for the API's cryptographic IDs, without Node imports.
export function parseExperimentLog(source: string) {
  const segments: ParsedSegment[] = [];
  let currentSegmentIndex: number | null = null;
  const records: {
    record: z.infer<typeof RunRecordSchema>;
    sourceLine: number;
    sourceText: string;
    segmentIndex: number;
  }[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = source.split("\n");
  for (const [index, sourceText] of lines.entries()) {
    const sourceLine = index + 1;
    if (!sourceText.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(sourceText);
    } catch (error) {
      // Only an unterminated object at the physical EOF may be an active append.
      // Syntax errors earlier in the object remain malformed, even at EOF.
      const message = error instanceof Error ? error.message : "";
      const position = /position (\d+)/.exec(message);
      const incomplete =
        index === lines.length - 1 &&
        sourceText.trimStart().startsWith("{") &&
        (/unexpected end|unterminated string|end of data/i.test(message) ||
          (position !== null && Number(position[1]) === sourceText.length));
      diagnostics.push({
        code: incomplete ? "INCOMPLETE_RECORD" : "INVALID_RECORD",
        message: incomplete
          ? "Trailing record is incomplete; waiting for completion on refresh."
          : "Invalid JSON record.",
        sourceLine,
      });
      continue;
    }
    if (typeof value === "object" && value !== null && "type" in value) {
      if (value.type !== "config" && value.type !== "run") continue;
      if (value.type === "config") {
        const result = ConfigRecordSchema.safeParse(value);
        if (result.success) {
          const index = segments.length;
          const fallback = defaultSegment(index, "header");
          const fields = [
            "name",
            "metricName",
            "metricUnit",
            "bestDirection",
          ] as const;
          const defaultedFields = fields.filter(
            (field) => result.data[field] === undefined,
          );
          segments.push({
            ...fallback,
            ...Object.fromEntries(
              fields.map((field) => [
                field,
                result.data[field] ?? fallback[field],
              ]),
            ),
            defaultedFields,
          } as ParsedSegment);
          currentSegmentIndex = index;
          if (defaultedFields.length > 0)
            diagnostics.push({
              code: "CONFIG_DEFAULTS_APPLIED",
              message: `Metric header used defaults for ${defaultedFields.join(", ")}.`,
              sourceLine,
            });
        } else
          diagnostics.push({
            code: "INVALID_CONFIG_RECORD",
            message: result.error.message,
            sourceLine,
          });
        continue;
      }
    }
    // Bad optional metrics must not discard an otherwise valid experiment.
    let candidate = value;
    if (typeof value === "object" && value !== null && "metrics" in value) {
      const metrics = value.metrics;
      if (
        typeof metrics === "object" &&
        metrics !== null &&
        !Array.isArray(metrics)
      ) {
        const entries = Object.entries(metrics);
        const valid = entries.filter(
          ([, metric]) => typeof metric === "number" && Number.isFinite(metric),
        );
        candidate = { ...value, metrics: Object.fromEntries(valid) };
        for (const [name] of entries.filter(
          ([, metric]) =>
            typeof metric !== "number" || !Number.isFinite(metric),
        ))
          diagnostics.push({
            code: "INVALID_SECONDARY_METRIC",
            message: `Secondary metric ${name} is not finite and was omitted.`,
            sourceLine,
          });
      } else {
        candidate = { ...value, metrics: undefined };
        diagnostics.push({
          code: "INVALID_SECONDARY_METRIC",
          message:
            "Secondary metrics must be a numeric object; they were omitted.",
          sourceLine,
        });
      }
    }
    // Bad optional advisory fields must not hide a valid attempt or win.
    for (const [field, schema, code] of [
      ["timestamp", RunRecordSchema.shape.timestamp, "INVALID_TIMESTAMP"],
      ["confidence", RunRecordSchema.shape.confidence, "INVALID_CONFIDENCE"],
      ["asi", RunRecordSchema.shape.asi, "INVALID_ASI"],
    ] as const) {
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        field in candidate &&
        !schema.safeParse((candidate as Record<string, unknown>)[field]).success
      ) {
        candidate = { ...candidate, [field]: undefined };
        diagnostics.push({
          code,
          message: `Invalid optional ${field} was omitted.`,
          sourceLine,
        });
      }
    }
    const result = RunRecordSchema.safeParse(candidate);
    if (!result.success) {
      diagnostics.push({
        code: "INVALID_RUN",
        message:
          "Run requires a positive number, finite metric, and known status.",
        sourceLine,
      });
      continue;
    }
    if (currentSegmentIndex === null) {
      segments.push(defaultSegment(0, "fallback"));
      currentSegmentIndex = 0;
      diagnostics.push({
        code: "FALLBACK_METRIC_CONFIG",
        message:
          "No valid metric header preceded this history; using metric, no unit, lower-is-better.",
        sourceLine,
      });
    }
    records.push({
      record: result.data,
      sourceLine,
      sourceText,
      segmentIndex: currentSegmentIndex,
    });
  }
  return { segments, records, diagnostics };
}

export function improvement(
  reference: number,
  value: number,
  direction: MetricConfig["bestDirection"],
): Improvement {
  const absolute =
    direction === "lower" ? reference - value : value - reference;
  return {
    reference,
    absolute,
    percentage: reference === 0 ? null : (absolute / Math.abs(reference)) * 100,
  };
}

export function calculateSegment(
  segment: Omit<
    SegmentSnapshot,
    | "runIds"
    | "baselineRunId"
    | "bestRunId"
    | "baselineMetric"
    | "bestMetric"
    | "cumulativeImprovement"
    | "wins"
    | "attempts"
  >,
  runs: RunSnapshot[],
): SegmentSnapshot {
  let baseline: RunSnapshot | null = null;
  let best: RunSnapshot | null = null;
  const wins: WinSummary[] = [];
  const attempts: AttemptPlotPoint[] = [];
  for (const [index, run] of runs.entries()) {
    let isWin = false;
    if (run.status === "keep") {
      if (!best) {
        baseline = run;
        best = run;
      } else if (
        segment.bestDirection === "lower"
          ? run.metric < best.metric
          : run.metric > best.metric
      ) {
        wins.push({
          runId: run.id,
          previousBestMetric: best.metric,
          incremental: improvement(
            best.metric,
            run.metric,
            segment.bestDirection,
          ),
          cumulative: improvement(
            baseline!.metric,
            run.metric,
            segment.bestDirection,
          ),
        });
        best = run;
        isWin = true;
      }
    }
    attempts.push({
      runId: run.id,
      attempt: index + 1,
      run: run.run,
      sourceLine: run.sourceLine,
      status: run.status,
      metric:
        run.status === "crash" || run.status === "checks_failed"
          ? null
          : run.metric,
      bestMetric: best?.metric ?? null,
      bestRunId: best?.id ?? null,
      isBaseline: baseline?.id === run.id,
      isWin,
    });
  }
  return {
    ...segment,
    runIds: runs.map((run) => run.id),
    baselineRunId: baseline?.id ?? null,
    bestRunId: best?.id ?? null,
    baselineMetric: baseline?.metric ?? null,
    bestMetric: best?.metric ?? null,
    cumulativeImprovement:
      baseline && best
        ? improvement(baseline.metric, best.metric, segment.bestDirection)
        : null,
    wins,
    attempts,
  };
}

// Temporary compatibility export for S01/S02 callers; it now supports segments.
export const parseSingleSegmentLog = parseExperimentLog;
