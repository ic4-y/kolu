/** Sync/pure forge detection from a remote URL.
 *
 *  The kernel names no forge by default — `PrProvider.kind` is a bare
 *  `string`. This module is the server-side dispatch helper: given a
 *  remote URL (as resolved from `git remote get-url origin`), classify
 *  it into a `ForgeKind` so the server can pick the right adapter.
 *
 *  Detection is sync and pure — no network probe. Probing unknown hosts
 *  is a privacy decision (egress to arbitrary hosts parsed from git
 *  remotes), not an implementation detail. Unknown forges fall through
 *  to the gh adapter, which handles GHE and degrades to silent `absent`
 *  on hosts it doesn't know (phase 0a).
 *
 *  Known Forgejo hosts: `codeberg.org` (built-in) plus
 *  `KOLU_FORGEJO_HOSTS` (comma-separated, for self-hosted instances). */

export type ForgeKind = "github" | "forgejo";

const FORGEJO_HOSTS_BUILTIN = new Set(["codeberg.org"]);

let forgejoHostsCache: Set<string> | null = null;

function forgejoHosts(): Set<string> {
  if (forgejoHostsCache !== null) return forgejoHostsCache;
  const env = process.env.KOLU_FORGEJO_HOSTS;
  const extra = env
    ? env
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0)
    : [];
  forgejoHostsCache = new Set([...FORGEJO_HOSTS_BUILTIN, ...extra]);
  return forgejoHostsCache;
}

/** Parse the host from a git remote URL.
 *
 *  Handles both HTTPS (`https://codeberg.org/forgejo/forgejo.git`) and
 *  SCP-style SSH (`git@codeberg.org:forgejo/forgejo.git`, including
 *  userless `codeberg.org:owner/repo.git` via SSH config). Returns null
 *  when the remote isn't a parseable URL (local paths, bare hostnames
 *  without a colon-separated path).
 *
 *  The WHATWG URL parser swallows SCP shorthand as a scheme
 *  (`codeberg.org:owner/repo.git` → scheme `codeberg.org:`, empty
 *  hostname), so the URL branch only fires when hostname is non-empty;
 *  SCP is the fallback grammar. */
export function parseRemoteHost(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname) return parsed.hostname.toLowerCase();
  } catch {
    // Not a parseable URL — fall through to SCP grammar.
  }
  const m = /^(?:[^@/]+@)?([^@:/]+):/.exec(trimmed);
  if (m?.[1]) return m[1].toLowerCase();
  return null;
}

/** Classify a remote URL's forge. Sync, pure (modulo the env-var read
 *  for `KOLU_FORGEJO_HOSTS`, which is cached after first access). */
export function detectForge(remoteUrl: string | null): ForgeKind {
  if (!remoteUrl) return "github";
  const host = parseRemoteHost(remoteUrl);
  if (!host) return "github";
  if (forgejoHosts().has(host)) return "forgejo";
  return "github";
}
