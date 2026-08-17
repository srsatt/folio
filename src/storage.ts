import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";

import { insertReport } from "./db";
import type { GitMetadata, ParsedReport, ReportMetadata, ReportRecord } from "./types";
import { renderStandaloneReport } from "./report/render";

export interface CreatedReport {
  record: ReportRecord;
  metadata: ReportMetadata;
}

export function slugify(title: string): string {
  const slug = title.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "report";
}

export function contentHash(source: string): string {
  return `sha256:${createHash("sha256").update(source.replace(/\r\n?/g, "\n")).digest("hex")}`;
}

function safeCleanupPath(reportsRoot: string, candidate: string): boolean {
  const child = relative(reportsRoot, candidate);
  return child !== "" && !child.startsWith("..") && !child.includes("/") && !child.includes("\\");
}

export async function storeReport(
  db: Database,
  home: string,
  parsed: ParsedReport,
  git: GitMetadata,
  supersedesOverride: string | null = null,
): Promise<CreatedReport> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const slug = slugify(parsed.frontmatter.title);
  const hash = contentHash(parsed.source);
  const reportsRoot = join(home, "reports");
  const reportDirectory = join(reportsRoot, id);
  const temporaryDirectory = join(reportsRoot, `.${id}.tmp`);
  const sourcePath = join(reportDirectory, "report.mdoc");
  const htmlPath = join(reportDirectory, "report.html");
  const supersedes = supersedesOverride ?? parsed.frontmatter.supersedes;
  const metadata: ReportMetadata = {
    schemaVersion: 1,
    id,
    slug,
    title: parsed.frontmatter.title,
    kind: parsed.frontmatter.kind,
    summary: parsed.summary,
    tags: parsed.frontmatter.tags,
    createdAt,
    contentHash: hash,
    repository: {
      key: git.repoKey,
      root: git.root,
      remote: git.remote,
      branch: git.branch,
      commit: git.commit,
      dirty: git.dirty,
    },
    supersedes,
  };
  const html = await renderStandaloneReport(parsed, metadata);
  const record: ReportRecord = {
    id,
    slug,
    schemaVersion: 1,
    title: metadata.title,
    kind: metadata.kind,
    summary: metadata.summary,
    tags: metadata.tags,
    sourceFormat: "folio-markdoc/v1",
    sourceText: parsed.source,
    sourcePath,
    htmlPath,
    contentHash: hash,
    repoKey: git.repoKey,
    repoRoot: git.root,
    repoRemote: git.remote,
    repoBranch: git.branch,
    repoCommit: git.commit,
    repoDirty: git.dirty,
    supersedesId: supersedes,
    createdAt,
  };

  await mkdir(reportsRoot, { recursive: true });
  await mkdir(temporaryDirectory);
  try {
    await Promise.all([
      Bun.write(join(temporaryDirectory, "report.mdoc"), parsed.source),
      Bun.write(join(temporaryDirectory, "report.html"), html),
      Bun.write(join(temporaryDirectory, "meta.json"), `${JSON.stringify(metadata, null, 2)}\n`),
    ]);
    await rename(temporaryDirectory, reportDirectory);
    try {
      insertReport(db, record);
    } catch (error) {
      if (safeCleanupPath(reportsRoot, reportDirectory)) await rm(reportDirectory, { recursive: true });
      throw error;
    }
  } catch (error) {
    if (safeCleanupPath(reportsRoot, temporaryDirectory)) await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return { record, metadata };
}
