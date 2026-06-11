/** Sync/pure forge detection from a remote URL.
 *
 *  The kernel names no forge. `parseRemoteHost` extracts the host from
 *  a git remote URL (HTTPS or SCP-style SSH). `isForgejoHost` classifies
 *  whether a host is a Forgejo/Gitea instance. The *closed* `ForgeKind`
 *  union and the `detectForge` function that returns it live at the
 *  dispatch site (server/providers.ts) — the leaf only exposes the
 *  primitives.
 *
 *  Detection is sync and pure — no network probe. Probing unknown hosts
 *  is a privacy decision (egress to arbitrary hosts parsed from git
 *  remotes), not an implementation detail. Unknown forges fall through
 *  to the gh adapter, which handles GHE and degrades to silent `absent`
 *  on hosts it doesn't know (phase 0a).
 *
 *  Known Forgejo hosts: `codeberg.org` (built-in) plus
 *  `KOLU_FORGEJO_HOSTS` (comma-separated, for self-hosted instances). */

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

/** Parse owner/repo from a remote URL. Returns null when the remote isn't
 *  a recognized forge URL (local path, unknown host, etc). Built on
 *  `parseRemoteHost` so the URL grammar lives in one place. */
export function parseRemoteUrl(
  remoteUrl: string,
): { host: string; owner: string; repo: string } | null {
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
  return { host, owner: parts[0]!, repo: parts[1]! };
}

/** Whether `host` is configured as a Forgejo/Gitea instance. The closed
 *  `ForgeKind` enum and the `detectForge(remoteUrl)` helper that uses
 *  this predicate live at the dispatch site, not in the leaf. */
export function isForgejoHost(host: string): boolean {
  return forgejoHosts().has(host);
}
