import type { Logger } from "kolu-shared";
import type { PrProvider } from "./pr-provider.ts";
import type { PrResult, PrWatcher } from "./index.ts";
import { resolveGitHubPr, subscribePrResolver } from "./resolve.ts";

export const githubPrProvider: PrProvider = {
  kind: "github",
  subscribe(repoRoot, branch, _remoteUrl, onChange, log) {
    const watcher = subscribePrResolver(
      (r, b, rlog) => resolveGitHubPr(r, b, rlog),
      onChange,
      log,
    );
    watcher.setGit(repoRoot, branch);
    return watcher;
  },
};
