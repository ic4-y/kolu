/** Shared log helper for PR-resolve failures.
 *
 *  Both gh and forgejo adapters use the same failure-logging policy:
 *  - absent → debug (expected: no PR on this branch)
 *  - unavailable with code "unknown" → error (actual bug)
 *  - unavailable with any other code → warn (degraded but recoverable)
 *
 *  Centralizing the policy in the leaf keeps the per-adapter resolver
 *  thin. The `forge` and `unavailable` labels are per-adapter strings
 *  (e.g. "gh", "forgejo") so log lines are grep-able per provider. */

import type { Logger } from "kolu-shared";
import type { PrResult } from "./schemas.ts";

export type PrFailureLabels = {
  /** Provider tag for the log message, e.g. "gh", "forgejo". */
  forge: string;
  /** Log message when the result is `absent`. */
  absentMessage: string;
  /** Log message when the result is `unavailable` with `unknown` code. */
  unknownErrorMessage: string;
  /** Log message for any other `unavailable` code. */
  unavailableMessage: string;
};

/** Route a failed PR resolve to the appropriate log level. */
export function logPrResolveFailure(
  err: unknown,
  result: PrResult,
  log: Logger,
  labels: PrFailureLabels,
): void {
  const ctx = { err: String(err), result: result.kind };
  if (result.kind === "absent") {
    log.debug(ctx, labels.absentMessage);
    return;
  }
  if (result.kind === "unavailable" && result.source.code === "unknown") {
    log.error(ctx, labels.unknownErrorMessage);
    return;
  }
  log.warn(
    result.kind === "unavailable" ? { ...ctx, code: result.source.code } : ctx,
    labels.unavailableMessage,
  );
}
