import Markdoc, { Tag, type Config, type Node, type Schema } from "@markdoc/markdoc";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import reviewCss from "../web/review.css" with { type: "text" };
// @ts-expect-error Bun's text loader returns JavaScript source rather than module exports.
import reviewClient from "../web/review.js" with { type: "text" };
import { embeddedJetBrainsMonoFontCss } from "../web/font";

import type { ParsedReport, ReportMetadata } from "../types";
import { MARKDOC_TAG_SCHEMA, type FolioTagName } from "./schema";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function textOf(node: Node): string {
  if (node.type === "text" || node.type === "code") return String(node.attributes.content ?? "");
  return node.children.map(textOf).join("");
}

function pathWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function lexicalRepoPath(repoRoot: string, repoPath: string): string {
  const candidate = resolve(repoRoot, ...repoPath.split("/"));
  if (!pathWithin(repoRoot, candidate)) throw new Error(`Repository path escapes Git root: ${repoPath}`);
  return candidate;
}

function fileHref(repoRoot: string | null, repoPath: string, lines?: string): string | null {
  if (!repoRoot) return null;
  const href = pathToFileURL(lexicalRepoPath(repoRoot, repoPath)).href;
  if (!lines) return href;
  const [start, end] = lines.split("-");
  return `${href}#L${start}${end ? `-L${end}` : ""}`;
}

function fileReference(repoRoot: string | null, path: string, lines?: string): Tag {
  const label = lines ? `${path}:${lines}` : path;
  const href = fileHref(repoRoot, path, lines);
  const code = new Tag("code", {}, [label]);
  const dataAttributes: Record<string, unknown> = {
    class: "folio-file-ref",
    "data-folio-path": path,
  };
  if (lines) dataAttributes["data-folio-lines"] = lines;
  return href
    ? new Tag("a", { ...dataAttributes, href, title: "Open repository file" }, [code])
    : new Tag("span", { ...dataAttributes, title: "Git repository unavailable" }, [code]);
}

async function mediaTag(node: Node, repoRoot: string | null): Promise<Tag> {
  const repoPath = String(node.attributes.path ?? "");
  if (!repoRoot) throw new Error(`Cannot attach media outside a Git repository: ${repoPath}`);
  const rootReal = await realpath(repoRoot);
  const candidateReal = await realpath(lexicalRepoPath(repoRoot, repoPath)).catch(() => null);
  if (!candidateReal || !pathWithin(rootReal, candidateReal)) {
    throw new Error(`Media path does not exist inside Git root: ${repoPath}`);
  }

  const file = Bun.file(candidateReal);
  const mime = file.type || "application/octet-stream";
  const declared = node.attributes.kind;
  const kind = declared === "image" || declared === "video"
    ? declared
    : mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : null;
  if (!kind || !mime.startsWith(`${kind}/`)) {
    throw new Error(`Attached media must be an image or video: ${repoPath} (${mime})`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
  const title = typeof node.attributes.title === "string" ? node.attributes.title : undefined;
  const caption = typeof node.attributes.caption === "string" ? node.attributes.caption.trim() : "";
  const titleAttribute = title ? { title } : {};
  const media = kind === "image"
    ? new Tag("img", { src: dataUrl, alt: String(node.attributes.alt ?? ""), ...titleAttribute, loading: "lazy" }, [])
    : new Tag("video", { controls: true, preload: "metadata", ...titleAttribute }, [new Tag("source", { src: dataUrl, type: mime }, [])]);

  const captionChildren: Array<Tag | string> = [];
  if (caption) captionChildren.push(caption, " · ");
  captionChildren.push(fileReference(repoRoot, repoPath));
  return new Tag("figure", {
    class: "folio-media",
    "data-folio-path": repoPath,
    "data-folio-media-kind": kind,
  }, [media, new Tag("figcaption", {}, captionChildren)]);
}

function badge(text: string): Tag {
  return new Tag("span", { class: "folio-badge" }, [text]);
}

function renderSemantic(
  name: FolioTagName,
  node: Node,
  config: Config,
  repoRoot: string | null,
): Tag {
  if (name === "summary") {
    return new Tag("section", { class: "folio-summary", "data-folio-context-kind": "summary" }, [
      new Tag("div", { class: "folio-eyebrow" }, ["Summary"]),
      ...node.transformChildren(config),
    ]);
  }
  if (name === "callout") {
    const type = String(node.attributes.type ?? "note");
    const title = String(node.attributes.title ?? type[0]?.toUpperCase() + type.slice(1));
    return new Tag("aside", { class: `folio-callout folio-callout-${type}`, "data-folio-context-kind": "callout", "data-folio-context-title": title }, [
      new Tag("div", { class: "folio-semantic-title" }, [title]),
      ...node.transformChildren(config),
    ]);
  }
  if (name === "details") {
    const attributes: Record<string, unknown> = { class: "folio-details" };
    if (node.attributes.open === true) attributes.open = true;
    return new Tag("details", attributes, [
      new Tag("summary", {}, [String(node.attributes.title)]),
      new Tag("div", { class: "folio-details-body" }, node.transformChildren(config)),
    ]);
  }
  if (name === "file" || name === "media") throw new Error(`Unexpected semantic renderer: ${name}`);

  const title = String(node.attributes.title ?? (name === "evidence" ? "Evidence" : name));
  const header: Array<Tag | string> = [new Tag("strong", {}, [title])];
  const attributeBadges: Record<string, string[]> = {
    finding: ["severity", "confidence"],
    decision: ["status"],
    recommendation: ["priority", "effort"],
    risk: ["severity", "likelihood"],
    evidence: [],
  };
  for (const key of attributeBadges[name] ?? []) {
    const value = node.attributes[key];
    if (value !== undefined) header.push(badge(`${key}: ${String(value)}`));
  }
  if (name === "evidence") {
    const path = typeof node.attributes.path === "string" ? node.attributes.path : null;
    const lines = typeof node.attributes.lines === "string" ? node.attributes.lines : undefined;
    const url = typeof node.attributes.url === "string" ? node.attributes.url : null;
    if (path) header.push(fileReference(repoRoot, path, lines));
    if (url) header.push(new Tag("a", { href: url, rel: "noreferrer", target: "_blank" }, ["Source link"]));
  }

  const attributes: Record<string, unknown> = {
    class: `folio-semantic folio-${name}`,
    "data-folio-context-kind": name,
    "data-folio-context-title": title,
  };
  if (typeof node.attributes.path === "string") attributes["data-folio-path"] = node.attributes.path;
  if (typeof node.attributes.lines === "string") attributes["data-folio-lines"] = node.attributes.lines;
  return new Tag("section", attributes, [
    new Tag("header", { class: "folio-semantic-header" }, header),
    new Tag("div", { class: "folio-semantic-body" }, node.transformChildren(config)),
  ]);
}

function renderConfig(repoRoot: string | null): Config {
  let blockIndex = 0;
  let section = "Summary";
  const annotate = (attributes: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...attributes,
    "data-folio-block-id": `b-${String(++blockIndex).padStart(4, "0")}`,
    "data-folio-block-order": blockIndex,
    "data-folio-annotatable": "true",
    "data-folio-section": section,
  });

  const nodes: Partial<Record<Node["type"], Schema>> = {
    paragraph: {
      transform(node, config) {
        return new Tag("p", annotate(), node.transformChildren(config));
      },
    },
    heading: {
      attributes: { level: { type: Number, render: false, required: true } },
      transform(node, config) {
        section = textOf(node).trim() || section;
        return new Tag(`h${node.attributes.level}`, annotate(), node.transformChildren(config));
      },
    },
    item: {
      transform(node, config) {
        return new Tag("li", annotate(), node.transformChildren(config));
      },
    },
    blockquote: {
      transform(node, config) {
        return new Tag("blockquote", annotate(), node.transformChildren(config));
      },
    },
    fence: {
      attributes: {
        content: { type: String, render: false, required: true },
        language: { type: String, render: false },
        process: { type: Boolean, render: false, default: true },
      },
      transform(node) {
        const language = String(node.attributes.language ?? "");
        return new Tag("pre", annotate(language ? { "data-language": language } : {}), [
          new Tag("code", language ? { class: `language-${language}` } : {}, [String(node.attributes.content ?? "")]),
        ]);
      },
    },
  };

  const tags: Record<string, Schema> = Object.fromEntries(Object.entries(MARKDOC_TAG_SCHEMA).map(([name, schema]) => [name, {
    ...schema,
    transform(node: Node, config: Config) {
      if (name === "file") return fileReference(repoRoot, String(node.attributes.path), typeof node.attributes.lines === "string" ? node.attributes.lines : undefined);
      if (name === "media") return mediaTag(node, repoRoot);
      return renderSemantic(name as FolioTagName, node, config, repoRoot);
    },
  }]));
  return { nodes, tags };
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export async function renderStandaloneReport(parsed: ParsedReport, metadata: ReportMetadata): Promise<string> {
  const transformed = await Markdoc.transform(parsed.ast, renderConfig(metadata.repository.root));
  const article = Markdoc.renderers.html(transformed);
  const fontCss = await embeddedJetBrainsMonoFontCss();
  const repo = metadata.repository;
  const gitBits = [
    repo.key,
    repo.branch,
    repo.commit ? repo.commit.slice(0, 7) : null,
    repo.dirty ? "dirty" : null,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en" data-folio-shell-version="2" data-folio-theme="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(metadata.title)} · Folio</title>
<style>${fontCss}${reviewCss}</style>
</head>
<body>
<header class="folio-report-header">
  <div class="folio-eyebrow">${escapeHtml(metadata.kind)} report</div>
  <h1>${escapeHtml(metadata.title)}</h1>
  <div class="folio-header-meta">
    <time datetime="${escapeHtml(metadata.createdAt)}">${escapeHtml(new Date(metadata.createdAt).toLocaleString())}</time>
    ${gitBits.length ? `<span>${gitBits.map((bit) => escapeHtml(String(bit))).join(" · ")}</span>` : ""}
  </div>
  ${metadata.tags.length ? `<div class="folio-tags">${metadata.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
</header>
<main class="folio-layout">
  <aside class="folio-sidebar">
    <nav aria-label="Table of contents">
      <div class="folio-eyebrow">Contents</div>
      <ol id="folio-toc"></ol>
    </nav>
    <section class="folio-preferences" aria-label="Display preferences">
      <label class="folio-theme-control" for="folio-theme">Theme
        <select id="folio-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
      </label>
    </section>
    <section class="folio-share" aria-label="Download report">
      <div class="folio-eyebrow">Download as</div>
      <div class="folio-share-actions">
        <button id="folio-download-html" type="button" aria-label="Download HTML">HTML</button>
        <button id="folio-download-pdf" type="button" aria-label="Download PDF">PDF</button>
        <button id="folio-download-markdown" type="button" aria-label="Download Markdown">Markdown</button>
      </div>
      <p>Downloads omit local repository links.</p>
    </section>
  </aside>
  <div class="folio-document">${article}</div>
  <aside class="folio-comment-sidebar" aria-label="Review comments">
    <header><strong>Comments</strong><span id="folio-visible-comment-count">0 here</span></header>
    <div id="folio-comment-list" class="folio-comment-list"><p class="folio-comment-empty">Select report text to leave feedback.</p></div>
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
<script id="folio-source" type="application/json">${safeJson(parsed.source)}</script>
<script type="module">${reviewClient.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;
}
