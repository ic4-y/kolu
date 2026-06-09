/** kolu-forgejo — Forgejo/Gitea PR resolution adapter.
 *
 *  Depends on `kolu-github` for the forge-neutral `PrResult` / `PrInfo`
 *  types and the generic watcher infrastructure. The resolver queries the
 *  Forgejo REST API directly — no external CLI dependency. */

export {
  parseForgejoRemote,
  resolveForgejoPr,
} from "./resolve.ts";
export { forgejoPrProvider } from "./provider.ts";
export type { ForgejoUnavailableCode } from "kolu-github";
export {
  ForgejoUnavailableCodeSchema,
  ForgejoUnavailableSchema,
} from "kolu-github";
