/** Re-exports Forgejo schemas from `kolu-github` — the canonical location
 *  for all PR unavailable source schemas (avoids circular deps). */

export {
  ForgejoUnavailableCodeSchema,
  ForgejoUnavailableSchema,
  reasonForForgejoCode,
} from "kolu-github";
export type { ForgejoUnavailableCode } from "kolu-github";
