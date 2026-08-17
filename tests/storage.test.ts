import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getReport, listReports, openDatabase } from "../src/db";
import { contentHash, storeReport } from "../src/storage";
import type { GitMetadata } from "../src/types";
import { validateReport } from "../src/report/validate";
import { minimalReport, removeTemporaryDirectory, temporaryDirectory } from "./helpers";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(removeTemporaryDirectory));
});

const noGit: GitMetadata = {
  root: null,
  remote: null,
  repoKey: null,
  branch: null,
  commit: null,
  dirty: null,
};

describe("report storage", () => {
  test("creates database and immutable report artifacts", async () => {
    const home = await temporaryDirectory("folio-storage-");
    temporary.push(home);
    const source = minimalReport();
    const db = openDatabase(home);
    const created = await storeReport(db, home, validateReport(source), noGit);
    const stored = getReport(db, created.record.id);

    expect(await Bun.file(join(home, "folio.sqlite")).exists()).toBe(true);
    expect(stored?.id).toBe(created.record.id);
    expect(stored?.sourceText).toBe(source);
    expect(stored?.contentHash).toBe(contentHash(source));
    expect(await Bun.file(created.record.sourcePath).text()).toBe(source);
    expect(await Bun.file(created.record.htmlPath).text()).toContain("<!doctype html>");
    const metadata = await Bun.file(join(home, "reports", created.record.id, "meta.json")).json();
    expect(metadata.id).toBe(created.record.id);
    expect(metadata.contentHash).toBe(created.record.contentHash);
    expect(listReports(db)).toHaveLength(1);
    db.close();
  });

  test("normalizes line endings before hashing", () => {
    expect(contentHash("a\r\nb\r")).toBe(contentHash("a\nb\n"));
  });

  test("keeps generated files outside source repository", async () => {
    const repo = await temporaryDirectory("folio-source-");
    const home = await temporaryDirectory("folio-home-");
    temporary.push(repo, home);
    const before = [...new Bun.Glob("**/*").scanSync({ cwd: repo, onlyFiles: false })];
    const db = openDatabase(home);
    await storeReport(db, home, validateReport(minimalReport()), { ...noGit, root: repo });
    const after = [...new Bun.Glob("**/*").scanSync({ cwd: repo, onlyFiles: false })];
    expect(after).toEqual(before);
    db.close();
  });

  test("rejects missing media before writing a report", async () => {
    const repo = await temporaryDirectory("folio-media-root-");
    const home = await temporaryDirectory("folio-media-home-");
    temporary.push(repo, home);
    const source = minimalReport('{% media path="artifacts/missing.png" alt="Missing artifact" /%}');
    const db = openDatabase(home);
    await expect(storeReport(db, home, validateReport(source), { ...noGit, root: repo })).rejects.toThrow("Media path does not exist");
    expect(listReports(db)).toHaveLength(0);
    db.close();
  });
});
