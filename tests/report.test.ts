import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { renderStandaloneReport } from "../src/report/render";
import type { GitMetadata, ReportMetadata } from "../src/types";
import { contentHash, slugify } from "../src/storage";
import { validateReport } from "../src/report/validate";
import { git, minimalReport, removeTemporaryDirectory, temporaryDirectory } from "./helpers";

const root = join(import.meta.dir, "..");
const gitMetadata: GitMetadata = {
  root,
  remote: null,
  repoKey: null,
  branch: "main",
  commit: git(root, "rev-parse", "HEAD"),
  dirty: true,
};

function metadata(source: string): ReportMetadata {
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    slug: slugify("Render test"),
    title: "Render test",
    kind: "general",
    summary: "Concise summary.",
    tags: ["rendering"],
    createdAt: "2026-08-17T12:00:00.000Z",
    contentHash: contentHash(source),
    repository: {
      key: gitMetadata.repoKey,
      root: gitMetadata.root,
      remote: gitMetadata.remote,
      branch: gitMetadata.branch,
      commit: gitMetadata.commit,
      dirty: gitMetadata.dirty,
    },
    supersedes: null,
  };
}

describe("standalone rendering", () => {
  test("embeds styles, review client, metadata, and deterministic block IDs", async () => {
    const source = minimalReport("## Result\n\nValue is **safe** and `fast`.");
    const html = await renderStandaloneReport(validateReport(source), metadata(source));
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).toContain("Copy All Comments");
    expect(html).toContain('id="folio-toc"');
    expect(html).toContain("Download HTML");
    expect(html).toContain("Download PDF");
    expect(html).toContain("Download Markdown");
    expect(html).toContain('id="folio-theme"');
    expect(html).toContain('class="folio-comment-sidebar"');
    expect(html).toContain('id="folio-source" type="application/json"');
    expect(html).toContain(JSON.stringify(source).replace(/</g, "\\u003c"));
    expect(html).toContain("folio:review:");
    expect(html).toContain('data-folio-block-id="b-0001"');
    expect(html).toContain('data-folio-section="Result"');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toContain('<article class="folio-document"><article>');
  });

  test("escapes source content", async () => {
    const source = minimalReport("Math: 2 < 3 & 4 > 2.");
    const html = await renderStandaloneReport(validateReport(source), metadata(source));
    expect(html).toContain("2 &lt; 3 &amp; 4 &gt; 2");
  });

  test("renders semantic and repository metadata", async () => {
    const source = minimalReport(`{% evidence title="Source" path="src/cli.ts" lines="1-4" %}

CLI entry point.

{% /evidence %}`);
    const html = await renderStandaloneReport(validateReport(source), metadata(source));
    expect(html).toContain('data-folio-context-kind="evidence"');
    expect(html).toContain('data-folio-path="src/cli.ts"');
    expect(html).toContain('class="folio-file-ref" data-folio-path="src/cli.ts" data-folio-lines="1-4"');
    expect(html).toContain("file://");
    expect(html).toContain("src/cli.ts:1-4");
  });

  test("embeds image media and keeps source link", async () => {
    const example = await Bun.file(join(root, "examples/auth-investigation.mdoc")).text();
    const parsed = validateReport(example);
    const meta = { ...metadata(example), title: parsed.frontmatter.title, kind: parsed.frontmatter.kind, summary: parsed.summary };
    const html = await renderStandaloneReport(parsed, meta);
    expect(html).toContain("data:image/svg+xml;base64,");
    expect(html).toContain('data-folio-media-kind="image"');
    expect(html).toContain("examples/artifacts/refresh-flow.svg");
    expect(html).not.toContain('title="undefined"');
  });

  test("renders readable code blocks", async () => {
    const source = minimalReport("```ts\nconst safe = true;\n```");
    const html = await renderStandaloneReport(validateReport(source), metadata(source));
    expect(html).toContain('<pre data-language="ts"');
    expect(html).toContain('<code class="language-ts">const safe = true;');
  });

  test("embeds video media in the standalone document", async () => {
    const repo = await temporaryDirectory("folio-video-");
    try {
      await Bun.write(join(repo, "run.mp4"), new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]));
      const source = minimalReport('{% media path="run.mp4" kind="video" caption="Recorded acceptance" /%}');
      const meta = metadata(source);
      meta.repository.root = repo;
      const html = await renderStandaloneReport(validateReport(source), meta);
      expect(html).toContain('data-folio-media-kind="video"');
      expect(html).toContain("data:video/mp4;base64,");
      expect(html).toContain("<video controls");
    } finally {
      await removeTemporaryDirectory(repo);
    }
  });
});
