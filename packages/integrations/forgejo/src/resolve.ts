/** Runtime resolver — Forgejo REST API for PR metadata.
 *  Node-only (uses `node:fetch` + `node:fs` for token resolution).
 *  Browser-bound callers import the wire schemas from `anyforge/schemas`
 *  and `kolu-forgejo/schemas` instead. The generic branch-change + polling
 *  loop lives in anyforge's `subscribePr`; this module is just the Forgejo
 *  adapter it dispatches to. */

import { logPrResolveFailure, parseRemoteUrl } from "anyforge";
import type { PrGitContext, PrProvider, PrResult } from "anyforge";
import { PrStateSchema } from "anyforge/schemas";
import type { Logger } from "kolu-shared";
import { z } from "zod";
import {
  classifyForgejoError,
  extractForgejoChecks,
  type ForgejoCommitStatus,
  mapForgejoPrState,
} from "./forgejo.ts";
import type { ForgejoUnavailableSource } from "./schemas.ts";
import { readForgejoToken } from "./token.ts";

const FETCH_TIMEOUT_MS = 5_000;

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

type Credential = { token: string; type: "Application" | "OAuth" };

async function forgejoFetch(
  url: string,
  cred: Credential | null,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (cred) {
    headers.Authorization =
      cred.type === "OAuth" ? `Bearer ${cred.token}` : `token ${cred.token}`;
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
  } finally {
    clearTimeout(timeout);
  }
}

/** Resolve a Forgejo PR for the current branch. Pure orchestration: parse
 *  remote, fetch PR list, match head repo+ref (fork-safe), fetch commit
 *  status, assemble PrResult. */
async function resolveForgejoPrImpl(
  git: PrGitContext,
  cred: Credential | null,
  log: Logger | undefined,
): Promise<PrResult<ForgejoUnavailableSource>> {
  const parsed = parseRemoteUrl(git.remoteUrl ?? "");
  if (!parsed) {
    return { kind: "absent" };
  }
  const { owner, repo, host } = parsed;
  const baseUrl = `https://${host}/api/v1`;

  const pr = await findPr(git.branch, baseUrl, owner, repo, cred);
  if (!pr) {
    return { kind: "absent" };
  }

  const headSha = await fetchHeadSha(baseUrl, owner, repo, pr.number, cred);
  const statuses = headSha
    ? await fetchCommitStatuses(baseUrl, owner, repo, headSha, cred, log)
    : undefined;

  const checks = extractForgejoChecks(statuses);
  return {
    kind: "ok",
    value: {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: PrStateSchema.parse(
        mapForgejoPrState({ state: pr.state, merged: pr.merged }),
      ),
      checks: checks.length > 0 ? rollupStatus(checks) : null,
      checkRuns: checks,
    },
  };
}

function rollupStatus(
  checks: { outcome: "pass" | "pending" | "fail" }[],
): "pass" | "pending" | "fail" {
  let worst: "pass" | "pending" | "fail" = "pass";
  for (const c of checks) {
    if (c.outcome === "fail") return "fail";
    if (c.outcome === "pending") worst = "pending";
  }
  return worst;
}

/** Find the PR for the current branch, querying both open and closed
 *  states. Matches head repo full_name (not just branch name) to avoid
 *  fork false-positives. */
async function findPr(
  branch: string,
  baseUrl: string,
  owner: string,
  repo: string,
  cred: Credential | null,
) {
  for (const state of ["open", "closed"] as const) {
    const limit = state === "open" ? 50 : 20;
    const data = await forgejoFetch(
      `${baseUrl}/repos/${owner}/${repo}/pulls?state=${state}&limit=${limit}`,
      cred,
    );
    const prs = ForgejoPrListSchema.parse(data);
    const fullName = `${owner}/${repo}`;
    const match = prs.find(
      (p) => p.head?.ref === branch && p.head?.repo?.full_name === fullName,
    );
    if (match) return match;
  }
  return null;
}

async function fetchHeadSha(
  baseUrl: string,
  owner: string,
  repo: string,
  prNumber: number,
  cred: Credential | null,
): Promise<string | null> {
  try {
    const data = await forgejoFetch(
      `${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`,
      cred,
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

/** Fetch commit statuses for a head SHA. Returns undefined when the fetch
 *  fails — the status is best-effort; a failure here means the user
 *  sees no CI info for this PR but the PR itself still resolves. */
async function fetchCommitStatuses(
  baseUrl: string,
  owner: string,
  repo: string,
  sha: string,
  cred: Credential | null,
  log: Logger | undefined,
): Promise<ForgejoCommitStatus[] | undefined> {
  try {
    const data = await forgejoFetch(
      `${baseUrl}/repos/${owner}/${repo}/commits/${sha}/status`,
      cred,
    );
    const parsed = ForgejoStatusResponseSchema.parse(data);
    return parsed.statuses;
  } catch (e) {
    log?.warn({ err: String(e) }, "forgejo: commit status fetch failed");
    return undefined;
  }
}

/** Look up the Forgejo PR for the current branch. */
export async function resolveForgejoPr(
  git: PrGitContext,
  log?: Logger,
): Promise<PrResult<ForgejoUnavailableSource>> {
  const parsed = parseRemoteUrl(git.remoteUrl ?? "");
  if (!parsed) {
    return { kind: "absent" };
  }
  const cred = readForgejoToken(parsed.host, log);
  try {
    return await resolveForgejoPrImpl(git, cred, log);
  } catch (err) {
    const result = classifyForgejoError(err);
    if (log) {
      logPrResolveFailure(err, result, log, {
        forge: "forgejo",
        absentMessage: "forgejo: no PR for branch",
        unknownErrorMessage: "forgejo: unknown error",
        unavailableMessage: "forgejo: unavailable",
      });
    }
    return result;
  }
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
