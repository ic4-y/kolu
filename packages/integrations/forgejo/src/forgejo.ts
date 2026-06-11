/** Pure Forgejo API response mappers — no I/O, no node-only APIs.
 *
 *  `resolve.ts` wraps these with the REST fetch; the wire shapes they
 *  produce live in `anyforge/schemas`. The Forgejo REST API returns
 *  commit statuses as a flat list (unlike GitHub's GraphQL rollup), so
 *  the mapping is simpler: each status has a `status` field
 *  (success/pending/warning/failure/error) and a `context` field (the
 *  check name). */

import type { CheckRun, PrResult, PrState } from "anyforge/schemas";
import { match, P } from "ts-pattern";
import type {
  ForgejoUnavailableSource,
  ForgejoUnavailableCode,
} from "./schemas.ts";

type CheckOutcome = "fail" | "pending" | "pass";

/** A single Forgejo commit status entry as the REST API returns it.
 *  Shape from `GET /repos/{owner}/{repo}/commits/{sha}/status`. */
export type ForgejoCommitStatus = {
  status?: string;
  context?: string;
};

/** A single Forgejo PR entry as the REST API returns it.
 *  Shape from `GET /repos/{owner}/{repo}/pulls`. */
export type ForgejoPullRequest = {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  merged?: boolean;
  head?: {
    ref?: string;
    repo?: {
      full_name?: string;
    } | null;
  };
  base?: {
    ref?: string;
    repo?: {
      full_name?: string;
    } | null;
  };
};

/** Classify a Forgejo commit status state into a check outcome.
 *  Forgejo states: success, pending, warning, failure, error.
 *  Maps warning → pass (non-blocking), error → fail (like GitHub). */
function classifyForgejoStatus(status: string | undefined): CheckOutcome {
  return match(status?.toLowerCase())
    .with("success", () => "pass" as const)
    .with("pending", () => "pending" as const)
    .with(P.union("failure", "error"), () => "fail" as const)
    .otherwise(() => "pass" as const);
}

/** Derive combined check status from Forgejo commit statuses.
 *  "fail" is terminal — short-circuit; "pending" is sticky until something
 *  fails. Returns null when no statuses are configured. */
export function deriveForgejoCheckStatus(
  statuses: ForgejoCommitStatus[] | undefined,
): "pass" | "pending" | "fail" | null {
  if (!statuses || statuses.length === 0) return null;
  let worst: CheckOutcome = "pass";
  for (const s of statuses) {
    const outcome = classifyForgejoStatus(s.status);
    if (outcome === "fail") return "fail";
    if (outcome === "pending") worst = "pending";
  }
  return worst;
}

/** Per-check breakdown of the commit statuses — the same entries
 *  `deriveForgejoCheckStatus` collapses, kept individual so the dock's
 *  PR pip tooltip can list which specific gate is red. */
export function extractForgejoChecks(
  statuses: ForgejoCommitStatus[] | undefined,
): CheckRun[] {
  if (!statuses) return [];
  return statuses.map((s) => ({
    name: s.context ?? "?",
    outcome: classifyForgejoStatus(s.status),
  }));
}

/** Map Forgejo PR state to the neutral PrState.
 *  Forgejo returns `state: "open" | "closed"` plus a separate `merged: bool`
 *  field. "closed + merged=true" → "merged"; "closed + merged=false" →
 *  "closed"; "open" → "open". */
export function mapForgejoPrState(pr: ForgejoPullRequest): PrState {
  if (pr.state === "closed" && pr.merged) return "merged";
  if (pr.state === "closed") return "closed";
  return "open";
}

/** Classify a Forgejo REST API failure into a PrResult.
 *
 *  The fetch error carries a typed `status` field (HTTP status code) so
 *  classification dispatches on a number, not a substring match against
 *  error message text. Timeouts are detected via the `code` field
 *  (node fetch sets `code: "ETIMEDOUT"` or similar on timeout).
 *
 *  FRAGILE: node's fetch error codes are not versioned. If Node rewords
 *  the timeout indicator, the match falls through to `unknown`. */
export function classifyForgejoError(
  err: unknown,
): PrResult<ForgejoUnavailableSource> {
  const e = err as { status?: number; code?: string; message?: string };
  const forgejoUnavailable = (
    code: ForgejoUnavailableCode,
  ): PrResult<ForgejoUnavailableSource> => ({
    kind: "unavailable",
    source: { provider: "forgejo", code },
  });
  if (e.status === 401 || e.status === 403) {
    return forgejoUnavailable("not-authenticated");
  }
  if (e.status === 404) {
    return forgejoUnavailable("not-found");
  }
  if (
    e.code === "ETIMEDOUT" ||
    e.code === "ERR_SOCKET_TIMEOUT" ||
    e.code === "AbortError"
  ) {
    return forgejoUnavailable("timed-out");
  }
  if (typeof e.status === "number" && e.status >= 400) {
    return forgejoUnavailable("unknown");
  }
  return forgejoUnavailable("unknown");
}
