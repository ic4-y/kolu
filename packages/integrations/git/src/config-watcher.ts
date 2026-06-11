/**
 * Refcounted shared `.git/config` watcher.
 *
 * Catches remote URL changes (`git remote set-url origin ...`) — anything
 * that rewrites `.git/config`'s contents. Lives alongside the HEAD
 * watcher (`head-watcher.ts`) so `subscribeGitInfo` can re-resolve when
 * the remote changes (forge detection depends on the remote URL).
 *
 * Uses `resolveGitCommonDir` (not `resolveGitDir`) because in a linked
 * worktree the config file lives in the COMMON git dir
 * (`<main>/.git/config`), not the per-worktree dir
 * (`.git/worktrees/<name>/config` — which doesn't exist).
 *
 * Implementation is a thin specialization of the generic shared
 * dir+filename watcher: one `fs.watch(gitCommonDir)` per gitCommonDir,
 * debounce 150ms, filename filter `config`. N callers watching the same
 * gitCommonDir collapse to one OS handle and one debounce timer.
 */

import { createDirFilenameWatcher } from "kolu-io";
import { resolveGitCommonDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

const configWatcher = createDirFilenameWatcher({
  resolveDir: resolveGitCommonDir,
  filename: "config",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: config",
});

export const watchGitConfig = configWatcher.watch;

/** Test-only inspector — number of distinct gitCommonDirs with active shared
 *  watchers. Used by unit tests to assert the singleton invariant. */
export const _sharedConfigWatcherCount = configWatcher._watcherCount;

/** Test-only teardown — close every active config-watcher and clear the
 *  singleton's registry. Production code must never call this. */
export const _resetSharedConfigWatchers = configWatcher._reset;
