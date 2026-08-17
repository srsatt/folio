import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ReportKind, ReportRecord } from "./types";

interface ReportRow {
  id: string;
  slug: string;
  schema_version: number;
  title: string;
  kind: ReportKind;
  summary: string;
  tags_json: string;
  source_format: string;
  source_text: string;
  source_path: string;
  html_path: string;
  content_hash: string;
  repo_key: string | null;
  repo_root: string | null;
  repo_remote: string | null;
  repo_branch: string | null;
  repo_commit: string | null;
  repo_dirty: number | null;
  supersedes_id: string | null;
  created_at: string;
}

export interface ReportListFilters {
  repo?: string | undefined;
  kind?: string | undefined;
  limit?: number | undefined;
  search?: string | undefined;
}

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      source_format TEXT NOT NULL,
      source_text TEXT NOT NULL,
      source_path TEXT NOT NULL,
      html_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      repo_key TEXT,
      repo_root TEXT,
      repo_remote TEXT,
      repo_branch TEXT,
      repo_commit TEXT,
      repo_dirty INTEGER,
      supersedes_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supersedes_id) REFERENCES reports(id)
    );
    CREATE INDEX reports_created_at_idx ON reports(created_at DESC);
    CREATE INDEX reports_repo_key_idx ON reports(repo_key);
    CREATE INDEX reports_kind_idx ON reports(kind);
  `,
}];

export function openDatabase(home: string): Database {
  const path = join(home, "folio.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    db.query<{ version: number }, []>("SELECT version FROM schema_migrations").all().map((row) => row.version),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(migration.version, new Date().toISOString());
    })();
  }
  return db;
}

function rowToRecord(row: ReportRow): ReportRecord {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags_json);
    if (Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string")) tags = parsed;
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    slug: row.slug,
    schemaVersion: row.schema_version,
    title: row.title,
    kind: row.kind,
    summary: row.summary,
    tags,
    sourceFormat: row.source_format,
    sourceText: row.source_text,
    sourcePath: row.source_path,
    htmlPath: row.html_path,
    contentHash: row.content_hash,
    repoKey: row.repo_key,
    repoRoot: row.repo_root,
    repoRemote: row.repo_remote,
    repoBranch: row.repo_branch,
    repoCommit: row.repo_commit,
    repoDirty: row.repo_dirty === null ? null : row.repo_dirty === 1,
    supersedesId: row.supersedes_id,
    createdAt: row.created_at,
  };
}

export function insertReport(db: Database, report: ReportRecord): void {
  db.query(`
    INSERT INTO reports (
      id, slug, schema_version, title, kind, summary, tags_json,
      source_format, source_text, source_path, html_path, content_hash,
      repo_key, repo_root, repo_remote, repo_branch, repo_commit, repo_dirty,
      supersedes_id, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?
    )
  `).run(
    report.id, report.slug, report.schemaVersion, report.title, report.kind, report.summary,
    JSON.stringify(report.tags), report.sourceFormat, report.sourceText, report.sourcePath,
    report.htmlPath, report.contentHash, report.repoKey, report.repoRoot, report.repoRemote,
    report.repoBranch, report.repoCommit, report.repoDirty === null ? null : report.repoDirty ? 1 : 0,
    report.supersedesId, report.createdAt,
  );
}

export function getReport(db: Database, id: string): ReportRecord | null {
  const row = db.query<ReportRow, [string]>("SELECT * FROM reports WHERE id = ?").get(id);
  return row ? rowToRecord(row) : null;
}

export function getLatestReport(db: Database): ReportRecord | null {
  const row = db.query<ReportRow, []>("SELECT * FROM reports ORDER BY created_at DESC LIMIT 1").get();
  return row ? rowToRecord(row) : null;
}

export function listReports(db: Database, filters: ReportListFilters = {}): ReportRecord[] {
  const where: string[] = [];
  const parameters: Array<string | number> = [];
  if (filters.repo) {
    where.push("repo_key = ?");
    parameters.push(filters.repo);
  }
  if (filters.kind) {
    where.push("kind = ?");
    parameters.push(filters.kind);
  }
  if (filters.search) {
    where.push("(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')");
    const escaped = filters.search.replace(/[\\%_]/g, (value) => `\\${value}`);
    parameters.push(`%${escaped}%`, `%${escaped}%`);
  }
  const limit = Math.max(1, Math.min(500, filters.limit ?? 20));
  parameters.push(limit);
  const sql = `SELECT * FROM reports${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
  return db.query<ReportRow, Array<string | number>>(sql).all(...parameters).map(rowToRecord);
}
