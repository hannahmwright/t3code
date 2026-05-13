import { Data, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ActivityIndexDocument, ThreadActivitySummaryUpdateInput } from "../document.ts";

export class ActivityIndexExportError extends Data.TaggedError("ActivityIndexExportError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ActivityIndexExportShape {
  readonly filePath: string;
  readonly readDocument: () => Effect.Effect<
    ActivityIndexDocument | undefined,
    ActivityIndexExportError
  >;
  readonly refresh: () => Effect.Effect<void, ActivityIndexExportError>;
  readonly upsertThreadSummary: (
    input: ThreadActivitySummaryUpdateInput,
  ) => Effect.Effect<boolean, ActivityIndexExportError>;
}

export class ActivityIndexExport extends ServiceMap.Service<
  ActivityIndexExport,
  ActivityIndexExportShape
>()("t3/activity-index/Services/ActivityIndexExport") {}
