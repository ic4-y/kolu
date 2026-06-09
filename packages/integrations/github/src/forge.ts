/** Forge detection from a git remote URL.
 *
 *  Parses the host from SSH or HTTPS remote URLs and maps it to a
 *  `ForgeType`. The host lists are extensible via environment variables
 *  so self-hosters can register their instances without code changes.
 *
 *  This is intentionally simple — a host-string lookup, not a protocol
 *  probe. If the remote isn't recognized, dispatch returns "unknown"
 *  and the PR provider stays silent. */

const GITHUB_HOSTS = new Set(["github.com"]);
const FORGEJO_HOSTS = new Set(["codeberg.org"]);

function loadExtraHosts(envVar: string): Set<string> {
  const raw = process.env[envVar];
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

let cachedForgejoHosts: Set<string> | null = null;
function getForgejoHosts(): Set<string> {
  if (cachedForgejoHosts === null) {
    cachedForgejoHosts = new Set([
      ...FORGEJO_HOSTS,
      ...loadExtraHosts("KOLU_FORGEJO_HOSTS"),
    ]);
  }
  return cachedForgejoHosts;
}

let cachedGitHubHosts: Set<string> | null = null;
function getGitHubHosts(): Set<string> {
  if (cachedGitHubHosts === null) {
    cachedGitHubHosts = new Set([
      ...GITHUB_HOSTS,
      ...loadExtraHosts("KOLU_GITHUB_HOSTS"),
    ]);
  }
  return cachedGitHubHosts;
}

export type ForgeType = "github" | "forgejo" | "unknown";

/** Extract the host from a git remote URL.
 *
 *  Handles both SSH (`git@host:owner/repo.git`) and HTTPS
 *  (`https://host/owner/repo.git`) forms. Returns null for unparseable
 *  URLs or non-standard schemes. */
export function parseRemoteHost(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;
  // SSH form: git@host:owner/repo or ssh://git@host/owner/repo
  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?(?:[^@]+@)?([^:/]+)[:/]/);
  if (sshMatch?.[1]) return sshMatch[1].toLowerCase();
  // HTTPS form: https://host/owner/repo
  try {
    const url = new URL(trimmed);
    return url.hostname.toLowerCase();
  } catch {
    // `new URL()` throws when the remote isn't a valid URL — expected
    // for non-URL remotes (file://, bare paths) that the SSH regex above
    // didn't match. Null signals "unparseable" to the caller.
    return null;
  }
}

/** Detect the forge type from a remote URL. Returns "unknown" when the
 *  host isn't recognized — callers should treat this as "no PR provider"
 *  and stay silent rather than logging warnings. */
export function detectForge(remoteUrl: string | null): ForgeType {
  if (!remoteUrl) return "unknown";
  const host = parseRemoteHost(remoteUrl);
  if (!host) return "unknown";
  if (getGitHubHosts().has(host)) return "github";
  if (getForgejoHosts().has(host)) return "forgejo";
  return "unknown";
}
