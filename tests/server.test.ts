import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { openDatabase } from "../src/db";
import { startArchiveServer } from "../src/server";
import { storeReport } from "../src/storage";
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

describe("archive server", () => {
  test("serves health, archive, and stored standalone report only", async () => {
    const home = await temporaryDirectory("folio-server-");
    temporary.push(home);
    const db = openDatabase(home);
    const created = await storeReport(db, home, validateReport(minimalReport()), noGit);
    const server = startArchiveServer(db, { port: 0 });
    const origin = `http://${server.hostname}:${server.port}`;
    try {
      const health = await fetch(`${origin}/health`);
      expect(await health.json()).toEqual({ ok: true });
      const archive = await fetch(origin);
      expect(await archive.text()).toContain("Minimal report");
      const report = await fetch(`${origin}/r/${created.record.id}`);
      const reportHtml = await report.text();
      expect(reportHtml).toContain("<!doctype html>");
      expect(reportHtml).toContain('class="folio-server-navigation"');
      expect(reportHtml).toContain('href="/">← Back to all reports</a>');
      expect((await fetch(`${origin}/r/unknown`)).status).toBe(404);
      expect((await fetch(`${origin}/comments`, { method: "POST" })).status).toBe(405);
    } finally {
      server.stop(true);
      db.close();
    }
  });

  test("rewrites repository links to a contained HTTP source viewer", async () => {
    const home = await temporaryDirectory("folio-server-");
    const repo = await temporaryDirectory("folio-repo-");
    temporary.push(home, repo);
    await Bun.write(join(repo, "referenced.ts"), "const answer = 42;\nconsole.log(answer);\n");
    await Bun.write(join(repo, "private.txt"), "not referenced\n");
    const source = minimalReport('Read {% file path="referenced.ts" lines="1-2" /%}.');
    const db = openDatabase(home);
    const created = await storeReport(db, home, validateReport(source), {
      ...noGit,
      root: repo,
      repoKey: "example/folio",
    });
    const server = startArchiveServer(db, { port: 0 });
    const origin = `http://${server.hostname}:${server.port}`;
    try {
      const report = await fetch(`${origin}/r/${created.record.id}`);
      const html = await report.text();
      expect(html).not.toContain('class="folio-file-ref" href="file://');
      expect(html).toContain(`/r/${created.record.id}/source?path=referenced.ts&amp;lines=1-2#L1-L2`);
      expect(html).not.toContain(`\"root\":\"${repo}`);
      expect(html).toContain('\"root\":null');

      const sourceView = await fetch(`${origin}/r/${created.record.id}/source?path=referenced.ts&lines=1-2`);
      expect(sourceView.status).toBe(200);
      const sourceHtml = await sourceView.text();
      expect(sourceHtml).toContain('class="shiki');
      expect(sourceHtml).toContain('data-line="1"');
      expect(sourceHtml).toContain('id="folio-theme"');
      expect(sourceHtml).toContain('class="folio-comment-sidebar"');
      expect(sourceHtml).toContain('data-folio-annotatable="true"');
      expect(sourceHtml).toContain("JetBrains Mono");
      expect(sourceHtml).not.toContain("background:#ffe69a");
      expect((await fetch(`${origin}/r/${created.record.id}/source?path=private.txt`)).status).toBe(404);
      expect((await fetch(`${origin}/r/${created.record.id}/source?path=../private.txt`)).status).toBe(400);
    } finally {
      server.stop(true);
      db.close();
    }
  });

  test("lists repositories in a right panel and filters reports", async () => {
    const home = await temporaryDirectory("folio-server-");
    temporary.push(home);
    const db = openDatabase(home);
    await storeReport(db, home, validateReport(minimalReport().replace("Minimal report", "Alpha report")), {
      ...noGit,
      repoKey: "srsatt/alpha",
    });
    await storeReport(db, home, validateReport(minimalReport().replace("Minimal report", "Beta report")), {
      ...noGit,
      repoKey: "srsatt/beta",
    });
    const server = startArchiveServer(db, { port: 0 });
    const origin = `http://${server.hostname}:${server.port}`;
    try {
      const archiveHtml = await (await fetch(origin)).text();
      expect(archiveHtml).toContain('class="repo-panel"');
      expect(archiveHtml).toContain("srsatt/alpha");
      expect(archiveHtml).toContain("srsatt/beta");

      const filteredHtml = await (await fetch(`${origin}/?q=report&kind=general&repo=${encodeURIComponent("srsatt/alpha")}`)).text();
      expect(filteredHtml).toContain("Alpha report");
      expect(filteredHtml).not.toContain("Beta report");
      expect(filteredHtml).toContain('<input type="hidden" name="repo" value="srsatt/alpha">');
      expect(filteredHtml).toContain('href="/?q=report&amp;kind=general&amp;repo=srsatt%2Falpha" aria-current="page"');
      expect(filteredHtml).toContain('href="/?q=report&amp;kind=general"');
    } finally {
      server.stop(true);
      db.close();
    }
  });

  test("renders old stored reports with the current review shell", async () => {
    const home = await temporaryDirectory("folio-server-");
    temporary.push(home);
    const db = openDatabase(home);
    const created = await storeReport(db, home, validateReport(minimalReport()), noGit);
    await Bun.write(created.record.htmlPath, "<!doctype html><title>Legacy report</title><main>legacy shell</main>");
    const server = startArchiveServer(db, { port: 0 });
    const origin = `http://${server.hostname}:${server.port}`;
    try {
      const response = await fetch(`${origin}/r/${created.record.id}`);
      const html = await response.text();
      expect(html).toContain('id="folio-toc"');
      expect(html).toContain('id="folio-download-html"');
      expect(html).toContain('id="folio-theme"');
      expect(html).not.toContain("legacy shell");
    } finally {
      server.stop(true);
      db.close();
    }
  });
});
