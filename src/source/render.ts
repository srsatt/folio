import { basename, extname } from "node:path";
import { codeToHtml, type BundledLanguage } from "shiki";
import reviewCss from "../web/review.css" with { type: "text" };
import sourceCss from "../web/source.css" with { type: "text" };
// @ts-expect-error Bun's text loader returns JavaScript source rather than module exports.
import reviewClient from "../web/review.js" with { type: "text" };

import type { ReportMetadata, ReportRecord } from "../types";
import { servedJetBrainsMonoFontCss } from "../web/font";

const EXTENSION_LANGUAGES: Record<string, BundledLanguage> = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".go": "go",
  ".graphql": "graphql",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsonc": "jsonc",
  ".jsx": "jsx",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".md": "markdown",
  ".mdoc": "markdown",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "shellscript",
  ".sql": "sql",
  ".svelte": "svelte",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".vue": "vue",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "shellscript",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function languageForPath(path: string): BundledLanguage {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  return (EXTENSION_LANGUAGES[extname(name)] ?? "text") as BundledLanguage;
}

export function metadataFromRecord(report: ReportRecord): ReportMetadata {
  return {
    schemaVersion: 1,
    id: report.id,
    slug: report.slug,
    title: report.title,
    kind: report.kind,
    summary: report.summary,
    tags: report.tags,
    createdAt: report.createdAt,
    contentHash: report.contentHash,
    repository: {
      key: report.repoKey,
      root: report.repoRoot,
      remote: report.repoRemote,
      branch: report.repoBranch,
      commit: report.repoCommit,
      dirty: report.repoDirty,
    },
    supersedes: report.supersedesId,
  };
}

export async function renderSourcePage(report: ReportRecord, path: string, source: string, lines: string | null): Promise<string> {
  const [startText, endText] = lines?.split("-") ?? [];
  const start = startText ? Number(startText) : null;
  const end = endText ? Number(endText) : start;
  const blockId = `source:${path}`;
  const highlighted = await codeToHtml(source, {
    lang: languageForPath(path),
    themes: { light: "night-owl-light", dark: "night-owl" },
    defaultColor: false,
    transformers: [{
      code(node) {
        this.addClassToHast(node, "folio-source-code");
        node.properties["data-folio-block-id"] = blockId;
        node.properties["data-folio-block-order"] = 1_000_000;
        node.properties["data-folio-annotatable"] = "true";
        node.properties["data-folio-section"] = path;
        node.properties["data-folio-path"] = path;
      },
      line(node, line) {
        node.properties.id = `L${line}`;
        node.properties["data-line"] = line;
        if (start !== null && end !== null && line >= start && line <= end) {
          this.addClassToHast(node, "folio-source-selected");
        }
      },
    }],
  });
  const metadata = metadataFromRecord(report);
  return `<!doctype html>
<html lang="en" data-folio-theme="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(path)} · ${escapeHtml(report.title)}</title>
<style>${servedJetBrainsMonoFontCss}${reviewCss}${sourceCss}</style>
</head>
<body>
<header class="folio-source-header">
  <div class="folio-source-title"><strong>${escapeHtml(path)}</strong><span>${escapeHtml(report.title)}</span></div>
  <label class="folio-theme-control" for="folio-theme">Theme
    <select id="folio-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
  </label>
</header>
<main class="folio-source-layout">
  <div class="folio-source-document">${highlighted}</div>
  <aside class="folio-comment-sidebar" aria-label="Review comments">
    <header><strong>Comments</strong><span id="folio-visible-comment-count">0 here</span></header>
    <div id="folio-comment-list" class="folio-comment-list"><p class="folio-comment-empty">Select code to leave feedback.</p></div>
  </aside>
</main>
<aside class="folio-toolbar" aria-label="Review tools">
  <span id="folio-comment-count">0 comments</span>
  <button id="folio-copy" type="button" disabled>Copy All Comments</button>
  <button id="folio-download" type="button" disabled>Download Comments.md</button>
  <button id="folio-clear" class="folio-secondary" type="button" disabled>Clear</button>
  <span id="folio-storage-note" class="folio-storage-note" hidden>Comments last for this tab only.</span>
</aside>
<button id="folio-comment-action" type="button" hidden>Comment</button>
<div id="folio-toast" role="status" aria-live="polite"></div>
<dialog id="folio-comment-dialog">
  <form method="dialog" id="folio-comment-form">
    <h2 id="folio-dialog-title">Add comment</h2>
    <blockquote id="folio-selected-quote"></blockquote>
    <label for="folio-comment-body">Feedback</label>
    <textarea id="folio-comment-body" rows="5" required></textarea>
    <div class="folio-dialog-actions">
      <button value="cancel" type="button" id="folio-cancel">Cancel</button>
      <button value="save" type="submit">Save</button>
    </div>
  </form>
</dialog>
<dialog id="folio-copy-fallback">
  <form method="dialog">
    <h2>Copy review feedback</h2>
    <p>Clipboard access failed. Copy text below manually.</p>
    <textarea id="folio-copy-text" rows="18" readonly></textarea>
    <button value="close">Close</button>
  </form>
</dialog>
<script id="folio-metadata" type="application/json">${safeJson(metadata)}</script>
<script type="module">${reviewClient.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;
}
