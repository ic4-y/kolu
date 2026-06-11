/** kolu-forgejo — Forgejo/Codeberg adapter for PR metadata.
 *
 *  Sibling adapter to kolu-github. Implements `PrProvider<ForgejoUnavailableSource>`
 *  against anyforge's generic contract. Uses the Forgejo REST API directly
 *  (not the `fj` CLI, which has no JSON output mode); tokens come from
 *  `fj auth login`'s keys.json with a `KOLU_FORGEJO_TOKEN` env-var fallback. */

export {
  classifyForgejoError,
  deriveForgejoCheckStatus,
  extractForgejoChecks,
  mapForgejoPrState,
} from "./forgejo.ts";
export { forgejoPrProvider, resolveForgejoPr } from "./resolve.ts";
