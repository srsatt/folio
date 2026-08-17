import { resolve } from "node:path";

import type { GitMetadata } from "./types";

function git(cwd: string, args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim() || null;
}

export function normalizeRemote(remote: string | null): string | null {
  if (!remote) return null;
  const value = remote.trim().replace(/\.git\/?$/, "");

  if (value.includes("://")) {
    try {
      const url = new URL(value);
      if (!url.hostname) return null;
      return `${url.hostname.toLowerCase()}/${url.pathname.replace(/^\/+|\/+$/g, "")}`;
    } catch {
      return null;
    }
  }

  const scp = value.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  return scp?.[1] && scp[2] ? `${scp[1].toLowerCase()}/${scp[2].replace(/^\/+/, "")}` : null;
}

export function collectGitMetadata(cwd = process.cwd()): GitMetadata {
  const rootText = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!rootText) {
    return {
      root: null,
      remote: null,
      repoKey: null,
      branch: null,
      commit: null,
      dirty: null,
    };
  }

  const root = resolve(rootText);
  const remote = git(root, ["remote", "get-url", "origin"]);
  const branch = git(root, ["branch", "--show-current"]);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const status = Bun.spawnSync(["git", "status", "--porcelain"], {
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
  });

  return {
    root,
    remote,
    repoKey: normalizeRemote(remote),
    branch,
    commit,
    dirty: status.exitCode === 0 ? status.stdout.byteLength > 0 : null,
  };
}
