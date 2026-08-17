import type { Node } from "@markdoc/markdoc";

export const REPORT_KINDS = [
  "investigation",
  "implementation",
  "review",
  "architecture",
  "benchmark",
  "plan",
  "incident",
  "general",
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

export interface FolioFrontmatter {
  schema: "folio/v1";
  title: string;
  kind: ReportKind;
  tags: string[];
  supersedes: string | null;
}

export interface GitMetadata {
  root: string | null;
  remote: string | null;
  repoKey: string | null;
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
}

export interface ValidationDiagnostic {
  line: number | null;
  code: string;
  message: string;
}

export interface ParsedReport {
  source: string;
  ast: Node;
  frontmatter: FolioFrontmatter;
  summary: string;
}

export interface ReportMetadata {
  schemaVersion: 1;
  id: string;
  slug: string;
  title: string;
  kind: ReportKind;
  summary: string;
  tags: string[];
  createdAt: string;
  contentHash: string;
  repository: {
    key: string | null;
    root: string | null;
    remote: string | null;
    branch: string | null;
    commit: string | null;
    dirty: boolean | null;
  };
  supersedes: string | null;
}

export interface ReportRecord {
  id: string;
  slug: string;
  schemaVersion: number;
  title: string;
  kind: ReportKind;
  summary: string;
  tags: string[];
  sourceFormat: string;
  sourceText: string;
  sourcePath: string;
  htmlPath: string;
  contentHash: string;
  repoKey: string | null;
  repoRoot: string | null;
  repoRemote: string | null;
  repoBranch: string | null;
  repoCommit: string | null;
  repoDirty: boolean | null;
  supersedesId: string | null;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  blockId: string;
  blockOrder: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  body: string;
  sectionTitle: string | null;
  evidence: string | null;
  createdAt: string;
  updatedAt: string;
}
