/** Zod schema for the Forgejo-specific PR-unavailable source — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the forgejo arm without pulling the package root, which transitively
 *  evaluates `node:child_process` and `node:fs` (the token-file read and
 *  REST fetch in `resolve.ts`). Mirrors the `kolu-github/schemas` precedent.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — zod and ts-pattern only. */

import { z } from "zod";

/** Typed Forgejo-failure code for the `unavailable` PrResult variant.
 *
 *  A discriminator separate from any human-readable display text so UI
 *  callers that want to dispatch per-failure can `match(code).exhaustive()`
 *  and get a compile error when a new code is added without a handler. */
export const ForgejoUnavailableCodeSchema = z.enum([
  "not-authenticated",
  "not-found",
  "timed-out",
  "unknown",
]);
export type ForgejoUnavailableCode = z.infer<
  typeof ForgejoUnavailableCodeSchema
>;

/** Display text for a forgejo unavailable code — single source of truth.
 *  Defined as a fresh `Record<ForgejoUnavailableCode, string>` literal so
 *  TypeScript's required/excess-property checks enforce both sides of
 *  exhaustiveness. */
const FORGEJO_REASONS: Record<ForgejoUnavailableCode, string> = {
  "not-authenticated": "forgejo: not authenticated",
  "not-found": "forgejo: not found",
  "timed-out": "forgejo: timed out",
  unknown: "forgejo: unknown error",
};

export function reasonForForgejoCode(code: ForgejoUnavailableCode): string {
  return FORGEJO_REASONS[code];
}

/** The forgejo arm of the app's closed `PrUnavailableSource` union: provider
 *  tag `"forgejo"` plus this adapter's typed code. The discriminated union
 *  over all forge arms composes in the app (kolu-common). */
export const ForgejoUnavailableSchema = z.object({
  provider: z.literal("forgejo"),
  code: ForgejoUnavailableCodeSchema,
});
export type ForgejoUnavailableSource = z.infer<typeof ForgejoUnavailableSchema>;
