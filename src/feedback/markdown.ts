import type { ReportMetadata, ReviewComment } from "../types";

function quote(text: string): string {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}

export function sortComments(comments: readonly ReviewComment[]): ReviewComment[] {
  return [...comments].sort((left, right) =>
    left.blockOrder - right.blockOrder
    || left.startOffset - right.startOffset
    || left.createdAt.localeCompare(right.createdAt));
}

export function buildFeedbackMarkdown(
  metadata: ReportMetadata,
  comments: readonly ReviewComment[],
): string {
  const lines = [
    `# Review feedback: ${metadata.title}`,
    "",
    `I reviewed Folio report \`${metadata.id}\`.`,
    "",
    "Please address every comment below.",
    "",
    "After addressing the feedback, briefly explain what changed and create a new Folio report if the report itself needs to be updated.",
    "",
    "## Context",
    "",
  ];

  if (metadata.repository.key) lines.push(`- Repository: \`${metadata.repository.key}\``);
  if (metadata.repository.branch) lines.push(`- Branch: \`${metadata.repository.branch}\``);
  if (metadata.repository.commit) lines.push(`- Commit: \`${metadata.repository.commit.slice(0, 7)}\``);
  lines.push(`- Report ID: \`${metadata.id}\``);

  sortComments(comments).forEach((comment, index) => {
    lines.push("", `## Comment ${index + 1}`, "");
    if (comment.sectionTitle) lines.push(`**Section:** ${comment.sectionTitle}`, "");
    if (comment.evidence) lines.push(`**Evidence:** \`${comment.evidence}\``, "");
    lines.push(quote(comment.selectedText), "", comment.body.trim());
  });

  return `${lines.join("\n").trimEnd()}\n`;
}
