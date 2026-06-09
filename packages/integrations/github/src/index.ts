/** kolu-github — GitHub PR resolution + forge-neutral PR schemas.
 *
 *  Leaf package: depends only on zod + ts-pattern. The server's
 *  `providers.ts` wraps these with process spawning (via `KOLU_GH_BIN`)
 *  and the channel publisher. See top comment in `schemas.ts` for the
 *  neutral-vs-gh-specific layout rationale. */

export { classifyGhError, deriveCheckStatus, prResultEqual } from "./github.ts";
export {
  type ForgeType,
  detectForge,
  parseRemoteHost,
} from "./forge.ts";
export {
  type GitHubPrWatcher,
  type PrWatcher,
  resolveGitHubPr,
  subscribeGitHubPr,
  subscribePrResolver,
} from "./resolve.ts";
export type {
  ForgejoUnavailableCode,
  GhUnavailableCode,
  GitHubCheck,
  GitHubCheckStatus,
  GitHubPrState,
  PrInfo,
  PrResult,
  PrUnavailableSource,
} from "./schemas.ts";
export {
  ForgejoUnavailableCodeSchema,
  ForgejoUnavailableSchema,
  GhUnavailableCodeSchema,
  GhUnavailableSchema,
  GitHubCheckStatusSchema,
  GitHubPrStateSchema,
  PrInfoSchema,
  PrResultSchema,
  PrUnavailableSourceSchema,
  prUnavailableReason,
  prUnavailableSource,
  prValue,
  reasonForForgejoCode,
  reasonForGhCode,
  reasonForSource,
} from "./schemas.ts";
