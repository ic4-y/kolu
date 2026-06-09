import type { PrProvider, PrWatcher } from "kolu-github";
import { subscribePrResolver } from "kolu-github";
import { resolveForgejoPr } from "./resolve.ts";

export const forgejoPrProvider: PrProvider = {
  kind: "forgejo",
  subscribe(repoRoot, branch, remoteUrl, onChange, log) {
    if (!remoteUrl) {
      // No remote URL — emit absent and return a no-op watcher so the
      // orchestrator has a handle to clean up.
      return {
        setGit() {},
        stop() {},
      };
    }
    const watcher = subscribePrResolver(
      (r, b, rlog) => resolveForgejoPr(r, b, remoteUrl, rlog),
      onChange,
      log,
    );
    watcher.setGit(repoRoot, branch);
    return watcher;
  },
};
