/** Forge detection from a git remote URL.
 *
 *  Parses the host from SSH or HTTPS remote URLs. Known hosts (github.com,
 *  codeberg.org) return immediately. Unknown hosts are probed via the
 *  Forgejo/Gitea version endpoint — if it responds with a version, they're
 *  treated as Forgejo/Gitea. Results are cached per host for the lifetime
 *  of the process. Self-hosted instances need no manual configuration. */

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
  // Try URL parser first — handles both https:// and ssh:// URLs.
  try {
    const url = new URL(trimmed);
    return url.hostname.toLowerCase();
  } catch {
    // Not a valid URL — try SSH shorthand: git@host:owner/repo
  }
  const sshMatch = trimmed.match(/^[^@]+@([^:]+):/);
  if (sshMatch?.[1]) return sshMatch[1].toLowerCase();
  return null;
}

/** Cache of async probe results: host → ForgeType. Populated lazily by
 *  `detectForge` when a host is unrecognized. Avoids re-probing the same
 *  host on every git event. */
const probeCache = new Map<string, ForgeType>();

/** Probe an unknown host to see if it serves a Forgejo/Gitea API.
 *  Cached per host — only fires once per process lifetime. */
export async function probeForgeType(host: string): Promise<ForgeType> {
  const cached = probeCache.get(host);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`https://${host}/api/v1/version`, {
      signal: controller.signal,
    });
    if (res.ok) {
      const body = (await res.json()) as { version?: string };
      if (body.version) {
        getForgejoHosts().add(host);
        probeCache.set(host, "forgejo");
        return "forgejo";
      }
    }
  } catch {
    // Probe failed — not a Forgejo/Gitea instance
  } finally {
    clearTimeout(timer);
  }
  probeCache.set(host, "unknown");
  return "unknown";
}

/** Detect the forge type from a remote URL. Known hosts return immediately;
 *  unknown hosts are probed asynchronously via `probeForgeType`. On first
 *  encounter, returns "unknown" while the probe is in flight, then the
 *  caller should re-check after the probe settles. */
export function detectForge(remoteUrl: string | null): ForgeType {
  if (!remoteUrl) return "unknown";
  const host = parseRemoteHost(remoteUrl);
  if (!host) return "unknown";
  if (getGitHubHosts().has(host)) return "github";
  if (getForgejoHosts().has(host)) return "forgejo";
  return "unknown";
}

/** Detect forge synchronously (known hosts only) AND fire a probe for
 *  unrecognized hosts. Returns a promise that resolves to the final forge
 *  type after any needed probe completes. Use this when you need the
 *  definitive answer before wiring up a watcher. */
export async function detectForgeAsync(
  remoteUrl: string | null,
): Promise<ForgeType> {
  const initial = detectForge(remoteUrl);
  if (initial !== "unknown") return initial;
  if (!remoteUrl) return "unknown";
  const host = parseRemoteHost(remoteUrl);
  if (!host) return "unknown";
  return probeForgeType(host);
}
