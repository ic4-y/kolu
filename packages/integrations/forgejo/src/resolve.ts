/** Runtime resolver — Forgejo REST API for PR metadata.
 *  Node-only (uses `node:fetch` + `node:fs` for token resolution).
 *  Browser-bound callers import the wire schemas from `anyforge/schemas`
 *  and `kolu-forgejo/schemas` instead. The generic branch-change + polling
 *  loop lives in anyforge's `subscribePr`; this module is just the Forgejo
 *  adapter it dispatches to. */

import { parseRemoteHost } from "anyforge";
import type { PrGitContext, PrProvider, PrResult } from "anyforge";
import { PrStateSchema } from "anyforge/schemas";
import type { Logger } from "kolu-shared";
import { z } from "zod";
import {
  classifyForgejoError,
  deriveForgejoCheckStatus,
  extractForgejoChecks,
  type ForgejoCommitStatus,
  type ForgejoPullRequest,
  mapForgejoPrState,
} from "./forgejo.ts";
import type { ForgejoUnavailableSource } from "./schemas.ts";
import { authHeader, readForgejoToken } from "./token.ts";

const FETCH_TIMEOUT_MS = 5_000;

/** Parse owner/repo from a remote URL. Returns null when the remote isn't
 *  a recognized forge URL (local path, unknown host, etc). */
function parseOwnerRepo(
  remoteUrl: string,
): { owner: string; repo: string; host: string } | null {
  const host = parseRemoteHost(remoteUrl);
  if (!host) return null;
  const trimmed = remoteUrl.trim();
  let pathname: string;
  try {
    const parsed = new URL(trimmed);
    pathname = parsed.pathname;
  } catch {
    const m = /^(?:[^@/]+@)?[^@:/]+:(.*)$/.exec(trimmed);
    if (!m) return null;
    pathname = m[1]!;
  }
  const parts = pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  return { owner: parts[0]!, repo: parts[1]!, host };
}

/** Shape returned by `GET /repos/{owner}/{repo}/pulls`. */
const ForgejoPrListSchema = z.array(
  z.object({
    number: z.number(),
    title: z.string(),
    html_url: z.string(),
    state: z.string(),
    merged: z.boolean().optional(),
    head: z
      .object({
        ref: z.string().optional(),
        repo: z
          .object({ full_name: z.string().optional() })
          .nullable()
          .optional(),
      })
      .optional(),
    base: z
      .object({
        ref: z.string().optional(),
        repo: z
          .object({ full_name: z.string().optional() })
          .nullable()
          .optional(),
      })
      .optional(),
  }),
);

/** Shape returned by `GET /repos/{owner}/{repo}/commits/{sha}/status`. */
const ForgejoStatusResponseSchema = z.object({
  state: z.string().optional(),
  statuses: z
    .array(
      z.object({
        status: z.string().optional(),
        context: z.string().optional(),
      }),
    )
    .optional(),
});

/** Typed fetch error carrying the HTTP status code. */
class ForgejoFetchError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ForgejoFetchError";
  }
}

async function forgejoFetch(
  url: string,
  token: string | null,
  authType: "Application" | "OAuth" | null,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token && authType) {
    headers["Authorization"] =
      authType === "OAuth" ? `Bearer ${token}` : `token ${token}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ForgejoFetchError(
        `Forgejo API ${res.status}: ${res.statusText}`,
        res.status,
      );
    }
    return await res.json();
  } catch (e) {
    if (e instanceof ForgejoFetchError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      const err = new Error("Fetch aborted") as Error & {
        code: string;
      };
      err.code = "AbortError";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

/** Look up the Forgejo PR for the current branch.
 *
 *  Uses `GET /repos/{owner}/{repo}/pulls` filtered by head branch, then
 *  matches head repo full_name to avoid fork false-positives (a fork
 *  branch with the same name as a base branch would otherwise match).
 *  Queries both open and closed states so merged/closed PRs resolve too.
 *
 *  CI status comes from `GET /repos/{owner}/{repo}/commits/{sha}/status`
 *  on the PR's head SHA — a flat list of commit statuses, unlike GitHub's
 *  GraphQL rollup. */
export async function resolveForgejoPr(
  git: PrGitContext & { remoteUrl?: string | null },
  log?: Logger,
): Promise<PrResult<ForgejoUnavailableSource>> {
  const remoteUrl = git.remoteUrl;
  if (!remoteUrl) {
    return { kind: "absent" };
  }
  const parsed = parseOwnerRepo(remoteUrl);
  if (!parsed) {
    return { kind: "absent" };
  }
  const { owner, repo, host } = parsed;
  const cred = readForgejoToken(host, log);
  const baseUrl = `https://${host}/api/v1`;

  try {
    const prData = await forgejoFetch(
      `${baseUrl}/repos/${owner}/${repo}/pulls?state=open&limit=50`,
      cred?.token ?? null,
      cred?.type ?? null,
    );
    const prs = ForgejoPrListSchema.parse(prData);
    const fullName = `${owner}/${repo}`;
    const pr = prs.find((p) => {
      const headRef = p.head?.ref;
      const headRepo = p.head?.repo?.full_name;
      const headBranch = git.branch;
      if (!headRef || !headRepo) return false;
      return headRef === headBranch && headRepo === fullName;
    });

    if (!pr) {
      const closedData = await forgejoFetch(
        `${baseUrl}/repos/${owner}/${repo}/pulls?state=closed&limit=20`,
        cred?.token ?? null,
        cred?.type ?? null,
      );
      const closedPrs = ForgejoPrListSchema.parse(closedData);
      const closedPr = closedPrs.find((p) => {
        const headRef = p.head?.ref;
        const headRepo = p.head?.repo?.full_name;
        const headBranch = git.branch;
        if (!headRef || !headRepo) return false;
        return headRef === headBranch && headRepo === fullName;
      });
      if (!closedPr) {
        return { kind: "absent" };
      }
      return buildPrResult(closedPr, baseUrl, owner, repo, cred, log);
    }

    return buildPrResult(pr, baseUrl, owner, repo, cred, log);
  } catch (err) {
    const result = classifyForgejoError(err);
    if (log) logForgejoResolveFailure(err, result, log);
    return result;
  }
}

async function buildPrResult(
  pr: z.infer<typeof ForgejoPrListSchema>[number],
  baseUrl: string,
  owner: string,
  repo: string,
  cred: { token: string; type: "Application" | "OAuth" } | null,
  log?: Logger,
): Promise<PrResult<ForgejoUnavailableSource>> {
  const headSha = pr.head?.ref
    ? await getHeadSha(baseUrl, owner, repo, pr.number, cred)
    : null;

  let statuses: ForgejoCommitStatus[] | undefined;
  if (headSha) {
    try {
      const statusData = await forgejoFetch(
        `${baseUrl}/repos/${owner}/${repo}/commits/${headSha}/status`,
        cred?.token ?? null,
        cred?.type ?? null,
      );
      const parsed = ForgejoStatusResponseSchema.parse(statusData);
      statuses = parsed.statuses;
    } catch (e) {
      log?.warn?.({ err: String(e) }, "forgejo: commit status fetch failed");
    }
  }

  return {
    kind: "ok",
    value: {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: PrStateSchema.parse(
        mapForgejoPrState({
          state: pr.state,
          merged: pr.merged,
        } as ForgejoPullRequest),
      ),
      checks: deriveForgejoCheckStatus(statuses),
      checkRuns: extractForgejoChecks(statuses),
    },
  };
}

async function getHeadSha(
  baseUrl: string,
  owner: string,
  repo: string,
  prNumber: number,
  cred: { token: string; type: "Application" | "OAuth" } | null,
): Promise<string | null> {
  try {
    const data = await forgejoFetch(
      `${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`,
      cred?.token ?? null,
      cred?.type ?? null,
    );
    const pr = z
      .object({
        head: z.object({ sha: z.string().optional() }).optional(),
      })
      .parse(data);
    return pr.head?.sha ?? null;
  } catch {
    return null;
  }
}

function logForgejoResolveFailure(
  err: unknown,
  result: PrResult,
  log: Logger,
): void {
  const ctx = { err: String(err), result: result.kind };
  if (result.kind === "absent") {
    log.debug(ctx, "forgejo: no PR for branch");
    return;
  }
  if (result.kind === "unavailable" && result.source.code === "unknown") {
    log.error(ctx, "forgejo: unknown error");
    return;
  }
  log.warn(
    result.kind === "unavailable" ? { ...ctx, code: result.source.code } : ctx,
    "forgejo: unavailable",
  );
}

/** The Forgejo adapter — the `PrProvider` the host injects into
 *  `subscribePr`. Typed at its concrete `ForgejoUnavailableSource` so
 *  `subscribePr` infers `S = ForgejoUnavailableSource` and its
 *  `PrResult<ForgejoUnavailableSource>` lands in the app's closed
 *  `PrResult` without a cast. */
export const forgejoPrProvider: PrProvider<ForgejoUnavailableSource> = {
  kind: "forgejo",
  resolve: resolveForgejoPr,
};
