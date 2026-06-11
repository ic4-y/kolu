/** Forgejo token resolution — read `fj auth login`'s keys.json, fall back
 *  to the `KOLU_FORGEJO_TOKEN` env var.
 *
 *  `fj` (forgejo-cli v0.5.0+) writes auth tokens to
 *  `~/.local/share/forgejo-cli/keys.json` (XDG data dir on Linux). The
 *  file is `{ "hosts": { "codeberg.org": { "type": "Application"|"OAuth",
 *  "token": "..." } } }`. Application tokens use `Authorization: token <t>`;
 *  OAuth tokens use `Authorization: Bearer <t>`.
 *
 *  This module is Node-only (reads the filesystem). The resolver calls
 *  `readForgejoToken(host)` per resolve so token changes (e.g. `fj auth
 *  login` mid-session) take effect without a server restart. */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";

export type ForgejoAuthType = "Application" | "OAuth";

export type ForgejoToken = {
  token: string;
  type: ForgejoAuthType;
};

/** Build the `Authorization` header value for a Forgejo API request.
 *  Application tokens use `token <t>`; OAuth tokens use `Bearer <t>`. */
export function authHeader(cred: ForgejoToken): string {
  return cred.type === "OAuth" ? `Bearer ${cred.token}` : `token ${cred.token}`;
}

/** Default keys.json path: XDG data dir on Linux. Override with
 *  `KOLU_FORGEJO_KEYS_PATH` for testing or non-standard installs. */
function keysPath(): string {
  const override = process.env.KOLU_FORGEJO_KEYS_PATH;
  if (override) return override;
  const xdgData =
    process.env.XDG_DATA_HOME ||
    path.join(process.env.HOME ?? "~", ".local", "share");
  return path.join(xdgData, "forgejo-cli", "keys.json");
}

type KeysJson = {
  hosts?: Record<
    string,
    {
      type?: string;
      token?: string;
    }
  >;
};

/** Read the Forgejo API token for `host` from `fj`'s keys.json, falling
 *  back to `KOLU_FORGEJO_TOKEN` env var (always Application type).
 *  Returns null when no token is available — the resolver classifies this
 *  as `not-authenticated`.
 *
 *  Reads the file on every call (no caching) so `fj auth login` mid-session
 *  takes effect without a server restart. The file is small (< 1KB) and
 *  the poll interval is 30s, so the I/O cost is negligible. */
export function readForgejoToken(
  host: string,
  log?: Logger,
): ForgejoToken | null {
  const p = keysPath();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw) as KeysJson;
    const entry = data.hosts?.[host];
    if (entry?.token) {
      const type: ForgejoAuthType =
        entry.type === "OAuth" ? "OAuth" : "Application";
      return { token: entry.token, type };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.warn({ err: message, path: p }, "forgejo: keys.json read failed");
    }
  }
  const envToken = process.env.KOLU_FORGEJO_TOKEN;
  if (envToken) {
    return { token: envToken, type: "Application" };
  }
  return null;
}
