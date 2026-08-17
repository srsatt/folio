import { afterEach, describe, expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

import { collectGitMetadata, normalizeRemote } from "../src/git";
import { git, removeTemporaryDirectory, temporaryDirectory } from "./helpers";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(removeTemporaryDirectory));
});

describe("Git metadata", () => {
  test("normalizes common remote forms", () => {
    expect(normalizeRemote("git@github.com:owner/repo.git")).toBe("github.com/owner/repo");
    expect(normalizeRemote("https://github.com/owner/repo.git")).toBe("github.com/owner/repo");
    expect(normalizeRemote("ssh://git@gitlab.com/group/repo.git")).toBe("gitlab.com/group/repo");
    expect(normalizeRemote(null)).toBeNull();
  });

  test("collects root, branch, commit, remote, and dirty state", async () => {
    const root = await temporaryDirectory("folio-git-");
    temporary.push(root);
    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "srsatt");
    git(root, "config", "user.email", "srsatt@gmail.com");
    git(root, "remote", "add", "origin", "git@github.com:owner/repo.git");
    await Bun.write(join(root, "tracked.txt"), "clean\n");
    git(root, "add", "tracked.txt");
    git(root, "commit", "-m", "fixture");

    const clean = collectGitMetadata(join(root, "."));
    expect(clean.root).toBe(await realpath(root));
    expect(clean.branch).toBe("main");
    expect(clean.commit).toHaveLength(40);
    expect(clean.repoKey).toBe("github.com/owner/repo");
    expect(clean.dirty).toBe(false);

    await Bun.write(join(root, "tracked.txt"), "dirty\n");
    expect(collectGitMetadata(root).dirty).toBe(true);
  });

  test("works outside Git", async () => {
    const root = await temporaryDirectory("folio-no-git-");
    temporary.push(root);
    expect(collectGitMetadata(root)).toEqual({
      root: null,
      remote: null,
      repoKey: null,
      branch: null,
      commit: null,
      dirty: null,
    });
  });
});
