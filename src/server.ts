import type { Database } from "bun:sqlite";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { getReport, listReports } from "./db";
import { renderStandaloneReport } from "./report/render";
import { isRepoRelativePath, LINE_RANGE } from "./report/schema";
import { validateReport } from "./report/validate";
import { metadataFromRecord, renderSourcePage } from "./source/render";
import type { ReportRecord } from "./types";
import { jetBrainsMonoPath } from "./web/font";

export interface ArchiveServerOptions {
  hostname?: string;
  port?: number;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function pathWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function sourceHref(reportId: string, path: string, lines?: string): string {
  const query = `path=${encodeURIComponent(path)}${lines ? `&lines=${encodeURIComponent(lines)}` : ""}`;
  if (!lines) return `/r/${encodeURIComponent(reportId)}/source?${query}`;
  const [start, end] = lines.split("-");
  return `/r/${encodeURIComponent(reportId)}/source?${query}#L${start}${end ? `-L${end}` : ""}`;
}

function rewriteRepositoryLinks(html: string, report: ReportRecord, allowRepositoryFiles: boolean): string {
  if (!report.repoRoot) return html;
  const repoRoot = report.repoRoot;
  return html.replace(/<a class="folio-file-ref"[^>]*>/g, (tag) => {
    const match = tag.match(/\shref="([^"]+)"/);
    if (!match?.[1]) return tag;
    let url: URL;
    try {
      url = new URL(match[1]);
    } catch {
      return tag;
    }
    if (url.protocol !== "file:") return tag;
    const hash = url.hash;
    url.hash = "";
    let candidate: string;
    try {
      candidate = fileURLToPath(url);
    } catch {
      return tag;
    }
    if (!pathWithin(repoRoot, candidate)) return tag;
    const repoPath = relative(repoRoot, candidate).split(sep).join("/");
    if (!isRepoRelativePath(repoPath)) return tag;
    if (!allowRepositoryFiles) {
      return tag.replace(/\shref="[^"]+"/, "").replace(/\stitle="[^"]+"/, "");
    }
    const lineMatch = hash.match(/^#L(\d+)(?:-L(\d+))?$/);
    const lines = lineMatch?.[1] ? `${lineMatch[1]}${lineMatch[2] ? `-${lineMatch[2]}` : ""}` : undefined;
    const href = escapeHtml(sourceHref(report.id, repoPath, lines));
    return tag.replace(`href="${match[1]}"`, `href="${href}"`).replace("Open repository file", "View repository source");
  });
}

function prepareServedReport(html: string, report: ReportRecord, allowRepositoryFiles: boolean): string {
  const withNavigation = html.replace(
    '<body>',
    '<body><nav class="folio-server-navigation" aria-label="Archive navigation"><a href="/">← Back to all reports</a></nav>',
  );
  const withSafeMetadata = withNavigation.replace(
    /(<script id="folio-metadata" type="application\/json">)([\s\S]*?)(<\/script>)/,
    (_match, opening: string, encoded: string, closing: string) => {
      try {
        const metadata = JSON.parse(encoded) as { repository?: Record<string, unknown> };
        if (metadata.repository) metadata.repository.root = null;
        return `${opening}${JSON.stringify(metadata).replace(/</g, "\\u003c")}${closing}`;
      } catch {
        return `${opening}${encoded}${closing}`;
      }
    },
  );
  return rewriteRepositoryLinks(withSafeMetadata, report, allowRepositoryFiles);
}

function referencedPaths(report: ReportRecord): Set<string> {
  const parsed = validateReport(report.sourceText, report.sourcePath);
  return new Set([...parsed.ast.walk()]
    .filter((node) => node.type === "tag" && typeof node.attributes.path === "string")
    .map((node) => String(node.attributes.path)));
}

async function serveRepositorySource(report: ReportRecord, url: URL): Promise<Response> {
  const repoPath = url.searchParams.get("path") ?? "";
  const lines = url.searchParams.get("lines");
  if (!isRepoRelativePath(repoPath) || (lines !== null && !LINE_RANGE.test(lines))) {
    return new Response("Invalid repository path or line range", { status: 400 });
  }
  if (!report.repoRoot || !referencedPaths(report).has(repoPath)) return new Response("Source reference not found", { status: 404 });
  const rootReal = await realpath(report.repoRoot).catch(() => null);
  const candidateReal = await realpath(resolve(report.repoRoot, ...repoPath.split("/"))).catch(() => null);
  if (!rootReal || !candidateReal || !pathWithin(rootReal, candidateReal)) return new Response("Source file not found", { status: 404 });
  const details = await stat(candidateReal).catch(() => null);
  if (!details?.isFile()) return new Response("Source file not found", { status: 404 });
  const file = Bun.file(candidateReal);
  if (/^(?:image|video|audio)\//.test(file.type) || file.type === "application/pdf") {
    return new Response(file, { headers: { "content-type": file.type, "content-disposition": "inline" } });
  }
  if (details.size > 2 * 1024 * 1024) return new Response("Source file is too large to display", { status: 413 });
  return new Response(await renderSourcePage(report, repoPath, await file.text(), lines), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self'",
    },
  });
}

function archivePage(db: Database, url: URL): string {
  const search = url.searchParams.get("q")?.trim() || undefined;
  const kind = url.searchParams.get("kind")?.trim() || undefined;
  const repo = url.searchParams.get("repo")?.trim() || undefined;
  const reports = listReports(db, { search, kind, repo, limit: 100 });
  const cards = reports.map((report) => `
    <article>
      <div class="meta">${escapeHtml(report.kind)} · ${escapeHtml(new Date(report.createdAt).toLocaleString())}</div>
      <h2><a href="/r/${encodeURIComponent(report.id)}">${escapeHtml(report.title)}</a></h2>
      <p>${escapeHtml(report.summary)}</p>
      <div class="meta">${[report.repoKey, report.repoBranch, report.repoCommit?.slice(0, 7)].filter(Boolean).map((value) => escapeHtml(String(value))).join(" · ")}</div>
      <div class="tags">${report.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
    </article>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Folio archive</title><style>
:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{max-width:850px;margin:0 auto;padding:3rem 1.2rem;line-height:1.55}h1{font-size:2.2rem}form{display:flex;flex-wrap:wrap;gap:.5rem;margin:2rem 0}input{min-width:12rem;flex:1;padding:.55rem}button{padding:.55rem .8rem}article{padding:1.2rem 0;border-top:1px solid #8885}article h2{margin:.2rem 0;font-size:1.3rem}article p{margin:.45rem 0}.meta{opacity:.7;font-size:.8rem}.tags{display:flex;gap:.35rem;margin-top:.5rem}.tags span{border:1px solid #8887;border-radius:2rem;padding:.08rem .42rem;font-size:.72rem}
</style></head><body>
<header><div>Local, read-only archive</div><h1>Folio reports</h1></header>
<form method="get"><input name="q" aria-label="Search" placeholder="Search title or summary" value="${escapeHtml(search ?? "")}"><input name="kind" aria-label="Kind" placeholder="Kind" value="${escapeHtml(kind ?? "")}"><input name="repo" aria-label="Repository" placeholder="Repository key" value="${escapeHtml(repo ?? "")}"><button>Filter</button></form>
<main>${cards || "<p>No reports found.</p>"}</main>
</body></html>`;
}

export function startArchiveServer(db: Database, options: ArchiveServerOptions = {}): ReturnType<typeof Bun.serve> {
  const hostname = options.hostname ?? "127.0.0.1";
  const allowRepositoryFiles = ["127.0.0.1", "localhost", "::1"].includes(hostname);
  return Bun.serve({
    hostname,
    port: options.port ?? 7331,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      if (url.pathname === "/health") return Response.json({ ok: true });
      if (url.pathname === "/assets/jetbrains-mono.woff2") {
        return new Response(Bun.file(jetBrainsMonoPath), {
          headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable" },
        });
      }
      if (url.pathname === "/") return new Response(archivePage(db, url), { headers: { "content-type": "text/html; charset=utf-8" } });
      const sourceMatch = url.pathname.match(/^\/r\/([^/]+)\/source$/);
      if (sourceMatch?.[1]) {
        if (!allowRepositoryFiles) return new Response("Repository source viewing is available on loopback only", { status: 403 });
        const report = getReport(db, decodeURIComponent(sourceMatch[1]));
        if (!report) return new Response("Report not found", { status: 404 });
        return serveRepositorySource(report, url);
      }
      const match = url.pathname.match(/^\/r\/([^/]+)$/);
      if (match?.[1]) {
        const report = getReport(db, decodeURIComponent(match[1]));
        if (!report) return new Response("Report not found", { status: 404 });
        const file = Bun.file(report.htmlPath);
        if (!await file.exists()) return new Response("Report artifact missing", { status: 404 });
        let html = await file.text();
        if (!html.includes('data-folio-shell-version="2"')) {
          try {
            html = await renderStandaloneReport(validateReport(report.sourceText, report.sourcePath), metadataFromRecord(report));
          } catch {
            // Preserve readable immutable artifact when original repository media no longer exists.
          }
        }
        return new Response(prepareServedReport(html, report, allowRepositoryFiles), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
}
