import { describe, expect, test } from "bun:test";

import { buildFeedbackMarkdown, sortComments } from "../src/feedback/markdown";
import type { ReportMetadata, ReviewComment } from "../src/types";

const metadata: ReportMetadata = {
  schemaVersion: 1,
  id: "11111111-1111-4111-8111-111111111111",
  slug: "refresh-report",
  title: "Refresh report",
  kind: "investigation",
  summary: "Summary",
  tags: [],
  createdAt: "2026-08-17T12:00:00.000Z",
  contentHash: "sha256:abc",
  repository: {
    key: "github.com/example/project",
    root: "/repo",
    remote: "git@github.com:example/project.git",
    branch: "feature/auth",
    commit: "0123456789abcdef",
    dirty: false,
  },
  supersedes: null,
};

function comment(overrides: Partial<ReviewComment>): ReviewComment {
  return {
    id: crypto.randomUUID(),
    blockId: "b-0001",
    blockOrder: 1,
    startOffset: 0,
    endOffset: 4,
    selectedText: "text",
    body: "Feedback",
    sectionTitle: "Findings",
    evidence: null,
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("feedback Markdown", () => {
  test("sorts in document and offset order", () => {
    const later = comment({ blockOrder: 2, selectedText: "later" });
    const second = comment({ startOffset: 8, endOffset: 12, selectedText: "same second" });
    const first = comment({ startOffset: 1, endOffset: 5, selectedText: "same first" });
    expect(sortComments([later, second, first]).map((item) => item.selectedText)).toEqual(["same first", "same second", "later"]);
  });

  test("includes report, repository, section, evidence, quote, and body", () => {
    const markdown = buildFeedbackMarkdown(metadata, [comment({
      selectedText: "line one\nline two",
      body: "Clarify this.\nThen add a test.",
      evidence: "src/auth.ts:4-8",
    })]);
    expect(markdown).toContain("# Review feedback: Refresh report");
    expect(markdown).toContain("- Repository: `github.com/example/project`");
    expect(markdown).toContain("- Commit: `0123456`");
    expect(markdown).toContain("**Section:** Findings");
    expect(markdown).toContain("**Evidence:** `src/auth.ts:4-8`");
    expect(markdown).toContain("> line one\n> line two");
    expect(markdown).toContain("Clarify this.\nThen add a test.");
  });

  test("omits unavailable metadata cleanly", () => {
    const noRepo = { ...metadata, repository: { key: null, root: null, remote: null, branch: null, commit: null, dirty: null } };
    const markdown = buildFeedbackMarkdown(noRepo, [comment({ sectionTitle: null })]);
    expect(markdown).not.toContain("Repository:");
    expect(markdown).not.toContain("Branch:");
    expect(markdown).not.toContain("Commit:");
    expect(markdown).not.toContain("**Section:**");
  });
});
