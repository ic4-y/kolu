/** Forge-neutral PR provider interface — mirrors the `AgentProvider`
 *  pattern. Each forge adapter implements this interface; the orchestrator
 *  (`startPrProvider`) looks up the provider by detected forge type and
 *  wires its lifecycle generically. Adding a new forge means implementing
 *  `PrProvider` — the orchestrator never changes. */

import type { Logger } from "kolu-shared";
import type { ForgeType } from "./forge.ts";
import type { PrResult } from "./schemas.ts";
import type { PrWatcher } from "./resolve.ts";

export interface PrProvider {
  readonly kind: ForgeType;
  subscribe(
    repoRoot: string,
    branch: string,
    remoteUrl: string | null,
    onChange: (pr: PrResult) => void,
    log: Logger,
  ): PrWatcher;
}
