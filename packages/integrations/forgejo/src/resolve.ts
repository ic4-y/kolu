/** Forgejo PR resolver — queries the Forgejo/Gitea REST API for PR
 *  metadata. Works against Codeberg (codeberg.org) and self-hosted
 *  Forgejo instances.
 *
 *  API reference (verified against codeberg.org):
 *  - PR list: GET /api/v1/repos/{owner}/{repo}/pulls?state=open
 *  - Combined status: GET /api/v1/repos/{owner}/{repo}/commits/{sha}/status
 *
 *  No auth needed for public repos; optional KOLU_FORGEJO_TOKEN env var
 *  for private instances. */

import type { Logger } from "kolu-shared";
import {
  parseRemoteHost,
  subscribePrResolver,
  type ForgejoUnavailableCode,
  type GitHubCheck,
  type GitHubCheckStatus,
  type PrInfo,
  type PrResult,
  type PrWatcher,
} from "kolu-github";

const FORGEJO_TIMEOUT_MS = 5_000;

function forgejoUnavailable(code: ForgejoUnavailableCode): PrResult {
  return {
    kind: "unavailable",
    source: { provider: "forgejo", code },
  };
}

/** Parse `{owner, repo}` from a remote URL.
 *
 *  Handles both SSH (`git@host:owner/repo.git`) and HTTPS
 *  (`https://host/owner/repo.git`) forms. Returns null when the URL
 *  doesn't match the expected `host/owner/repo` pattern. */
export function parseForgejoRemote(
  remoteUrl: string,
): { host: string; owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;
  const host = parseRemoteHost(trimmed);
  if (!host) return null;
  // SSH form: git@host:owner/repo.git
  const sshMatch = trimmed.match(/^[^@]+@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch?.[1] && sshMatch[2]) {
    return { host, owner: sshMatch[1], repo: sshMatch[2] };
  }
  // HTTPS form: https://host/owner/repo.git
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      const repo = parts[1].replace(/\.git$/, "");
      return { host, owner: parts[0], repo };
    }
  } catch {
    // fall through
  }
  return null;
}

interface ForgejoPr {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged: boolean;
  head: { ref: string; sha: string };
}

interface ForgejoCombinedStatus {
  state: string;
  statuses: Array<{ status: string; context: string }>;
}

function mapPrState(state: string, merged: boolean): PrInfo["state"] {
  if (merged) return "merged";
  if (state === "closed") return "closed";
  return "open";
}

function mapCheckStatus(status: string): GitHubCheckStatus {
  switch (status) {
    case "success":
      return "pass";
    case "failure":
    case "error":
      return "fail";
    case "pending":
    case "warning":
      return "pending";
    default:
      return "pending";
  }
}

function mapCombinedState(state: string): GitHubCheckStatus | null {
  switch (state) {
    case "success":
      return "pass";
    case "failure":
    case "error":
      return "fail";
    case "pending":
      return "pending";
    default:
      return null;
  }
}

async function forgejoFetch<T>(url: string, token: string | null): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORGEJO_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (token) headers.Authorization = `token ${token}`;
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`forgejo API ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve the Forgejo PR for the given branch.
 *
 *  Queries the open PRs for the repo, filters by `head.ref === branch`,
 *  then fetches the combined commit status for the head SHA. Returns
 *  `absent` when no PR matches, `unavailable` on API failures. */
export async function resolveForgejoPr(
  _repoRoot: string,
  branch: string,
  remoteUrl: string,
  log?: Logger,
): Promise<PrResult> {
  const parsed = parseForgejoRemote(remoteUrl);
  if (!parsed) {
    log?.debug({ remoteUrl }, "forgejo: unparseable remote URL");
    return { kind: "absent" };
  }
  const { host, owner, repo } = parsed;
  const baseUrl = `https://${host}`;
  const token = process.env.KOLU_FORGEJO_TOKEN ?? null;

  try {
    const pulls = await forgejoFetch<ForgejoPr[]>(
      `${baseUrl}/api/v1/repos/${owner}/${repo}/pulls?state=open&limit=100`,
      token,
    );
    const match = pulls.find((pr) => pr.head.ref === branch);
    if (!match) {
      return { kind: "absent" };
    }

    let checks: GitHubCheckStatus | null = null;
    let checkRuns: GitHubCheck[] = [];
    try {
      const status = await forgejoFetch<ForgejoCombinedStatus>(
        `${baseUrl}/api/v1/repos/${owner}/${repo}/commits/${match.head.sha}/status`,
        token,
      );
      checks = mapCombinedState(status.state);
      checkRuns = status.statuses.map((s) => ({
        name: s.context,
        outcome: mapCheckStatus(s.status),
      }));
    } catch (err) {
      log?.debug({ err }, "forgejo: status fetch failed (non-fatal)");
    }

    return {
      kind: "ok",
      value: {
        number: match.number,
        title: match.title,
        url: match.html_url,
        state: mapPrState(match.state, match.merged),
        checks,
        checkRuns,
      },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      log?.warn({ err }, "forgejo: API timed out");
      return forgejoUnavailable("timed-out");
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("401") || msg.includes("403")) {
      log?.warn({ remoteUrl }, "forgejo: authentication failed");
      return forgejoUnavailable("not-configured");
    }
    if (msg.includes("404")) {
      log?.debug({ remoteUrl }, "forgejo: repository not found");
      return forgejoUnavailable("not-found");
    }
    log?.error({ err: msg }, "forgejo: API error");
    return forgejoUnavailable("unknown");
  }
}

/** Subscribe to Forgejo PR changes for a terminal.
 *
 *  Binds the `remoteUrl` into the resolver so the generic watcher's
 *  `setGit(repoRoot, branch)` signature stays forge-neutral. The
 *  `remoteUrl` is captured at subscription time — if the user changes
 *  the remote, the caller should stop and re-subscribe. */
export function subscribeForgejoPr(
  remoteUrl: string,
  onChange: (pr: PrResult) => void,
  log?: Logger,
): PrWatcher {
  return subscribePrResolver(
    (repoRoot, branch, rlog) =>
      resolveForgejoPr(repoRoot, branch, remoteUrl, rlog),
    onChange,
    log,
  );
}
