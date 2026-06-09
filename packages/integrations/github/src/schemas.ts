/** Zod schemas + pure helpers for PR metadata.
 *
 *  Owns both the gh-specific shapes (`GitHubCheckStatus`, `Gh*`) and — for
 *  now — the provider-neutral `PrResult` / `PrInfo` / `PrUnavailableSource`
 *  scaffolding. The neutrals live here because `PrResult.ok.value` was
 *  `GitHubPrInfo`-shaped when first introduced and splitting the package dep
 *  direction would have inverted (`kolu-common` → `kolu-github`). When a
 *  second provider lands — srid/agency#10 — promote the neutrals to their
 *  own leaf (or to `kolu-common`) and have each provider package import
 *  them. */

import { match } from "ts-pattern";
import { z } from "zod";

// --- GitHub PR info ---

export const GitHubCheckStatusSchema = z.enum(["pending", "pass", "fail"]);
export type GitHubCheckStatus = z.infer<typeof GitHubCheckStatusSchema>;

export const GitHubPrStateSchema = z.enum(["open", "closed", "merged"]);
export type GitHubPrState = z.infer<typeof GitHubPrStateSchema>;

/** Per-check entry from GitHub's `statusCheckRollup`. The dock pip's
 *  tooltip lists these so a reviewer sees which specific gate is red
 *  without opening the PR. `name` is the CheckRun's name (e.g.
 *  `ci::biome@x86_64-linux`) or the StatusContext's `context`. */
export const GitHubCheckSchema = z.object({
  name: z.string(),
  outcome: GitHubCheckStatusSchema,
});
export type GitHubCheck = z.infer<typeof GitHubCheckSchema>;

/** Forge-neutral PR info shape. Despite living in `kolu-github`, these
 *  fields are common across GitHub, Forgejo, GitLab, and other forges.
 *  Each adapter maps its forge-specific API response to this shape.
 *  Future: extract to a neutral package when the dep direction bites. */
export const PrInfoSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  /** PR state: open, closed, or merged. */
  state: GitHubPrStateSchema,
  /** Combined CI status: pending, pass, or fail. Null if no checks configured. */
  checks: GitHubCheckStatusSchema.nullable(),
  /** Per-check breakdown — same data `checks` rolls up. Empty when no
   *  checks are configured. `.default([])` so an older server emitting
   *  payloads without this field still parses on a newer client. */
  checkRuns: z.array(GitHubCheckSchema).default([]),
});
export type PrInfo = z.infer<typeof PrInfoSchema>;

// --- gh-specific unavailable code ---

/** Typed gh-failure code for the `unavailable` PrResult variant.
 *
 *  A discriminator separate from any human-readable display text so UI
 *  callers that want to dispatch per-failure can `match(code).exhaustive()`
 *  and get a compile error when a new code is added without a handler —
 *  rather than string-comparing display text and silently breaking on typo.
 *
 *  Named with the `Gh` prefix so a parallel `BktUnavailableCodeSchema` lives
 *  alongside this one when bkt lands; `PrUnavailableSourceSchema` already
 *  reserves the `provider` discriminator for the tagged-union extension. */
export const GhUnavailableCodeSchema = z.enum([
  "not-installed",
  "not-authenticated",
  "timed-out",
  "unknown",
]);
export type GhUnavailableCode = z.infer<typeof GhUnavailableCodeSchema>;

/** Display text for a gh unavailable code — single source of truth. Defined
 *  as a fresh `Record<GhUnavailableCode, string>` literal (not wrapped in
 *  `match`) so TypeScript's required/excess-property checks enforce both
 *  sides of exhaustiveness — adding a code without updating this table
 *  fails compilation, and removing one leaves a dead key that also fails. */
const GH_REASONS: Record<GhUnavailableCode, string> = {
  "not-installed": "gh: not installed",
  "not-authenticated": "gh: not authenticated",
  "timed-out": "gh: timed out",
  unknown: "gh: unknown error",
};

export function reasonForGhCode(code: GhUnavailableCode): string {
  return GH_REASONS[code];
}

// --- Provider-tagged unavailable source ---

export const GhUnavailableSchema = z.object({
  provider: z.literal("gh"),
  code: GhUnavailableCodeSchema,
});

// --- Forgejo-specific unavailable code ---

export const ForgejoUnavailableCodeSchema = z.enum([
  "not-configured",
  "timed-out",
  "not-found",
  "unknown",
]);
export type ForgejoUnavailableCode = z.infer<
  typeof ForgejoUnavailableCodeSchema
>;

const FORGEJO_REASONS: Record<ForgejoUnavailableCode, string> = {
  "not-configured": "forgejo: no token configured",
  "timed-out": "forgejo: timed out",
  "not-found": "forgejo: repository not found",
  unknown: "forgejo: unknown error",
};

export function reasonForForgejoCode(code: ForgejoUnavailableCode): string {
  return FORGEJO_REASONS[code];
}

export const ForgejoUnavailableSchema = z.object({
  provider: z.literal("forgejo"),
  code: ForgejoUnavailableCodeSchema,
});

/** Which provider classified the failure, plus that provider's typed code.
 *
 *  UI dispatch sites that render recovery instructions should
 *  `match(source.provider).exhaustive()` so adding a new provider arm
 *  forces every render site to handle it. */
export const PrUnavailableSourceSchema = z.discriminatedUnion("provider", [
  GhUnavailableSchema,
  ForgejoUnavailableSchema,
]);
export type PrUnavailableSource = z.infer<typeof PrUnavailableSourceSchema>;

/** Display string for any unavailable source — dispatches on provider to the
 *  provider's own reason lookup. `.exhaustive()` forces a compile error when
 *  a new provider arm lands until a matching `.with` is added here. */
export function reasonForSource(source: PrUnavailableSource): string {
  return match(source)
    .with({ provider: "gh" }, ({ code }) => reasonForGhCode(code))
    .with({ provider: "forgejo" }, ({ code }) => reasonForForgejoCode(code))
    .exhaustive();
}

// --- PrResult ---

/** PR resolution state.
 *
 *  Decomplects distinct conditions that `PrInfo | null` used to
 *  collapse into one value:
 *    pending     — resolver is running (or stale after a branch change)
 *    ok          — resolver succeeded; a PR exists for this branch
 *    absent      — resolver succeeded; no PR for this branch (expected case)
 *    unavailable — resolver couldn't run; `source` carries the provider +
 *                  typed failure code, and the display reason is derived by
 *                  `reasonForSource`.
 *
 *  The UI needs to distinguish "absent" (nothing to show) from "unavailable"
 *  (show a warning with recovery instructions). Keeping the provenance in
 *  the same field as the value avoids a sibling-flag invariant.
 *
 *  Analogous schemas for git/agent/foreground are not introduced yet — their
 *  failure modes don't currently surface as user-actionable warnings. If they
 *  do, mirror this shape per-provider rather than inventing a cross-cutting
 *  status registry (see PR description for juspay/kolu#148). */
export const PrResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("ok"), value: PrInfoSchema }),
  z.object({ kind: z.literal("absent") }),
  z.object({
    kind: z.literal("unavailable"),
    source: PrUnavailableSourceSchema,
  }),
]);
export type PrResult = z.infer<typeof PrResultSchema>;

/** Extract the `PrInfo` when `kind === "ok"`, else `null`.
 *  Lets SolidJS `<Show when={prValue(meta.pr)}>` work without tripping on the
 *  object-truthy trap (every variant is a non-null object). */
export function prValue(pr: PrResult): PrInfo | null {
  return pr.kind === "ok" ? pr.value : null;
}

/** Single source of truth for the `#123 Title` PR label used in
 *  notification text, tooltips, and any other plain-string surface. */
export function prLabel(pr: PrInfo): string {
  return `#${pr.number} ${pr.title}`;
}

/** Extract the display reason when `kind === "unavailable"`, else `null`. */
export function prUnavailableReason(pr: PrResult): string | null {
  return pr.kind === "unavailable" ? reasonForSource(pr.source) : null;
}

/** Extract the tagged source when `kind === "unavailable"`, else `null`. Use
 *  this when the UI needs to dispatch on provider/code; `prUnavailableReason`
 *  is enough for a plain string tooltip. */
export function prUnavailableSource(pr: PrResult): PrUnavailableSource | null {
  return pr.kind === "unavailable" ? pr.source : null;
}
