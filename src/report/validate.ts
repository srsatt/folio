import Markdoc, { type Node } from "@markdoc/markdoc";
import YAML from "yaml";

import {
  REPORT_KINDS,
  type FolioFrontmatter,
  type ParsedReport,
  type ReportKind,
  type ValidationDiagnostic,
} from "../types";
import {
  BLOCK_TAGS,
  FOLIO_TAGS,
  LINE_RANGE,
  MARKDOC_TAG_SCHEMA,
  REPORT_ID,
  SEMANTIC_ID,
  TAG_ATTRIBUTES,
  isRepoRelativePath,
  isSafeEvidenceUrl,
  isSafeLink,
  type FolioTagName,
} from "./schema";

const FRONTMATTER_FIELDS = new Set(["schema", "title", "kind", "tags", "supersedes"]);
const MEDIA_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);

export class FolioValidationError extends Error {
  constructor(
    readonly file: string,
    readonly diagnostics: ValidationDiagnostic[],
  ) {
    super("report validation failed");
    this.name = "FolioValidationError";
  }
}

function lineOf(node: Node): number | null {
  const value = node.lines[0];
  return value === undefined ? null : value + 1;
}

function textOf(node: Node): string {
  if (node.type === "text" || node.type === "code") return String(node.attributes.content ?? "");
  if (node.type === "softbreak" || node.type === "hardbreak") return "\n";
  return node.children.map(textOf).join("");
}

function add(
  diagnostics: ValidationDiagnostic[],
  code: string,
  message: string,
  node?: Node,
): void {
  diagnostics.push({ code, message, line: node ? lineOf(node) : null });
}

function parseFrontmatter(ast: Node, diagnostics: ValidationDiagnostic[]): FolioFrontmatter | null {
  const raw = ast.attributes.frontmatter;
  if (typeof raw !== "string") {
    add(diagnostics, "frontmatter.missing", "Report must begin with YAML frontmatter.");
    return null;
  }

  let value: unknown;
  try {
    value = YAML.parse(raw);
  } catch (error) {
    add(diagnostics, "frontmatter.yaml", `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add(diagnostics, "frontmatter.type", "Frontmatter must be a YAML mapping.");
    return null;
  }

  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (!FRONTMATTER_FIELDS.has(key)) add(diagnostics, "frontmatter.unknown", `Unknown frontmatter field: ${key}.`);
  }

  if (object.schema !== "folio/v1") add(diagnostics, "frontmatter.schema", "`schema` must equal `folio/v1`.");

  const title = typeof object.title === "string" ? object.title.trim() : "";
  if (title.length < 1 || title.length > 160) {
    add(diagnostics, "frontmatter.title", "`title` must contain 1 to 160 characters after trimming.");
  }

  const kind = typeof object.kind === "string" ? object.kind : "";
  if (!REPORT_KINDS.includes(kind as ReportKind)) {
    add(diagnostics, "frontmatter.kind", `\`kind\` must be one of: ${REPORT_KINDS.join(", ")}.`);
  }

  const inputTags = object.tags === undefined ? [] : object.tags;
  const tags: string[] = [];
  if (!Array.isArray(inputTags) || inputTags.some((tag) => typeof tag !== "string")) {
    add(diagnostics, "frontmatter.tags", "`tags` must be an array of strings.");
  } else {
    const seen = new Set<string>();
    for (const rawTag of inputTags as string[]) {
      const tag = rawTag.trim();
      if (tag.length < 1 || tag.length > 40) {
        add(diagnostics, "frontmatter.tag", "Each tag must contain 1 to 40 characters after trimming.");
        continue;
      }
      const key = tag.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        tags.push(tag);
      }
    }
    if (tags.length > 10) add(diagnostics, "frontmatter.tags-limit", "A report may contain at most 10 unique tags.");
  }

  const supersedesValue = object.supersedes;
  const supersedes = typeof supersedesValue === "string" ? supersedesValue.trim() : null;
  if (supersedesValue !== undefined && (!supersedes || !REPORT_ID.test(supersedes))) {
    add(diagnostics, "frontmatter.supersedes", "`supersedes` must be a valid Folio report UUID.");
  }

  if (diagnostics.some((item) => item.code.startsWith("frontmatter."))) return null;
  return {
    schema: "folio/v1",
    title,
    kind: kind as ReportKind,
    tags: tags.slice(0, 10),
    supersedes,
  };
}

function validateAttribute(
  tag: FolioTagName,
  name: string,
  value: unknown,
  node: Node,
  diagnostics: ValidationDiagnostic[],
): void {
  const rule = TAG_ATTRIBUTES[tag][name as keyof (typeof TAG_ATTRIBUTES)[FolioTagName]] as unknown;
  if (rule === undefined) {
    add(diagnostics, "tag.attribute-unknown", `Unknown attribute \`${name}\` on \`${tag}\`.`, node);
    return;
  }
  if (Array.isArray(rule) && (typeof value !== "string" || !rule.includes(value))) {
    add(diagnostics, "tag.attribute-enum", `Invalid \`${tag}.${name}\`. Expected one of: ${rule.join(", ")}. Received: ${String(value)}.`, node);
  } else if ((rule === "string" || rule === "required-string") && typeof value !== "string") {
    add(diagnostics, "tag.attribute-string", `\`${tag}.${name}\` must be a string.`, node);
  } else if (rule === "id" && (typeof value !== "string" || !SEMANTIC_ID.test(value))) {
    add(diagnostics, "tag.attribute-id", `\`${tag}.id\` must match ${SEMANTIC_ID.source}.`, node);
  } else if ((rule === "path" || rule === "required-path") && (typeof value !== "string" || !isRepoRelativePath(value))) {
    add(diagnostics, "tag.attribute-path", `\`${tag}.${name}\` must be a path relative to the Git root without \`.\` or \`..\` segments.`, node);
  } else if (rule === "lines" && (typeof value !== "string" || !LINE_RANGE.test(value))) {
    add(diagnostics, "tag.attribute-lines", `\`${tag}.lines\` must be a line number or range such as \`84-117\`.`, node);
  } else if (rule === "url" && (typeof value !== "string" || !isSafeEvidenceUrl(value))) {
    add(diagnostics, "tag.attribute-url", `\`${tag}.url\` must use http or https.`, node);
  } else if (rule === "boolean" && typeof value !== "boolean") {
    add(diagnostics, "tag.attribute-boolean", `\`${tag}.${name}\` must be a boolean.`, node);
  }
}

function validateAst(ast: Node, diagnostics: ValidationDiagnostic[]): string | null {
  const nodes = [...ast.walk()];
  const tags = nodes.filter((node) => node.type === "tag");
  const summaries = tags.filter((node) => node.tag === "summary");

  if (summaries.length === 0) add(diagnostics, "summary.missing", "Report body must contain exactly one `summary` block.");
  if (summaries.length > 1) add(diagnostics, "summary.multiple", "Report body may contain only one `summary` block.", summaries[1]);

  const firstMeaningful = ast.children.find((node) => node.type !== "comment");
  if (firstMeaningful?.type !== "tag" || firstMeaningful.tag !== "summary") {
    add(diagnostics, "summary.position", "The first meaningful body node must be the `summary` block.", firstMeaningful);
  }

  const summaryNode = summaries[0];
  let summary: string | null = null;
  if (summaryNode) {
    summary = textOf(summaryNode).replace(/\s+/g, " ").trim();
    if (!summary) add(diagnostics, "summary.empty", "The `summary` block must contain text.", summaryNode);
    if (summary.length > 1200) add(diagnostics, "summary.length", "Summary must not exceed 1200 characters.", summaryNode);
    if ([...summaryNode.walk()].some((node) => node !== summaryNode && (node.type === "heading" || node.type === "tag"))) {
      add(diagnostics, "summary.content", "Summary may contain inline Markdown but no headings or custom tags.", summaryNode);
    }
  }

  const ids = new Map<string, Node>();
  const parents: Node[] = [];
  const visit = (node: Node): void => {
    if (node.type === "heading") {
      const level = Number(node.attributes.level);
      if (level === 1) add(diagnostics, "heading.h1", "H1 headings are forbidden; title comes from frontmatter.", node);
      if (level > 4) add(diagnostics, "heading.depth", "Headings deeper than H4 are forbidden.", node);
    }
    if (node.type === "image") add(diagnostics, "markdown.image", "Markdown images are forbidden. Use the `media` tag for attached images or videos.", node);
    if (node.type === "s") add(diagnostics, "markdown.strikethrough", "Strikethrough is not part of Folio Markdoc v1.", node);
    if (node.type === "link") {
      const href = String(node.attributes.href ?? "");
      if (!isSafeLink(href)) add(diagnostics, "link.unsafe", "Links must use http, https, mailto, or an in-document # anchor.", node);
    }
    if (node.type === "text") {
      const content = String(node.attributes.content ?? "");
      if (/<\/?[A-Za-z][^>]*>/.test(content)) add(diagnostics, "html.raw", "Raw HTML is forbidden.", node);
      if (/\]\(\s*(?:javascript|data|file|vbscript):/i.test(content)) add(diagnostics, "link.unsafe", "Unsafe URL scheme in Markdown link.", node);
    }
    if (node.type === "error" || node.errors.length > 0) {
      add(diagnostics, "markdoc.syntax", node.errors[0]?.message ?? "Invalid Markdoc syntax.", node);
    }

    if (node.type === "tag") {
      const tag = node.tag ?? "";
      if (!FOLIO_TAGS.includes(tag as FolioTagName)) {
        add(diagnostics, "tag.unknown", `Unknown custom tag: \`${tag}\`.`, node);
      } else {
        const name = tag as FolioTagName;
        const rules = TAG_ATTRIBUTES[name] as Record<string, unknown>;
        for (const [attribute, value] of Object.entries(node.attributes)) validateAttribute(name, attribute, value, node, diagnostics);
        for (const [attribute, rule] of Object.entries(rules)) {
          if ((rule === "required-string" || rule === "required-path") && node.attributes[attribute] === undefined) {
            add(diagnostics, "tag.attribute-required", `Missing required attribute \`${name}.${attribute}\`.`, node);
          }
        }
        const id = node.attributes.id;
        if (typeof id === "string" && SEMANTIC_ID.test(id)) {
          if (ids.has(id)) add(diagnostics, "tag.id-duplicate", `Duplicate semantic ID: \`${id}\`.`, node);
          else ids.set(id, node);
        }
        if (name === "evidence" && node.attributes.path === undefined && node.attributes.url === undefined && !textOf(node).trim()) {
          add(diagnostics, "evidence.empty", "Evidence needs `path`, `url`, or body content.", node);
        }
        if (name === "media" && node.children.length > 0) add(diagnostics, "media.children", "`media` must be self-closing.", node);
        if (name === "media") {
          const path = typeof node.attributes.path === "string" ? node.attributes.path : "";
          const extension = path.split(".").pop()?.toLowerCase() ?? "";
          const kind = node.attributes.kind;
          if ((kind === "image" || (!kind && MEDIA_IMAGE_EXTENSIONS.has(extension))) && !String(node.attributes.alt ?? "").trim()) {
            add(diagnostics, "media.alt", "Image media requires non-empty `alt` text.", node);
          }
        }
        if (name === "file" && !node.inline) add(diagnostics, "file.inline", "`file` is an inline self-closing tag.", node);
        const blockParent = [...parents].reverse().find((parent) => parent.type === "tag" && BLOCK_TAGS.includes(parent.tag as FolioTagName));
        if (blockParent && name !== "file") {
          add(diagnostics, "tag.nested", `Custom block \`${name}\` cannot be nested inside \`${blockParent.tag}\`.`, node);
        }
      }
    }

    parents.push(node);
    for (const child of node.children) visit(child);
    parents.pop();
  };
  visit(ast);

  const markdocErrors = Markdoc.validate(ast, { tags: MARKDOC_TAG_SCHEMA });
  for (const error of markdocErrors) {
    if (["tag-undefined", "attribute-undefined", "attribute-missing-required", "attribute-value-invalid"].includes(error.error.id)) continue;
    diagnostics.push({
      code: `markdoc.${error.error.id}`,
      line: error.lines[0] === undefined ? null : error.lines[0] + 1,
      message: error.error.message,
    });
  }

  return summary;
}

export function validateReport(sourceText: string, file = "<stdin>"): ParsedReport {
  const source = sourceText.replace(/\r\n?/g, "\n");
  const diagnostics: ValidationDiagnostic[] = [];
  let ast: Node;
  try {
    ast = Markdoc.parse(source, { file, location: true });
  } catch (error) {
    throw new FolioValidationError(file, [{
      code: "markdoc.parse",
      line: null,
      message: error instanceof Error ? error.message : String(error),
    }]);
  }

  const frontmatter = parseFrontmatter(ast, diagnostics);
  const summary = validateAst(ast, diagnostics);
  if (!frontmatter || !summary || diagnostics.length > 0) throw new FolioValidationError(file, diagnostics);
  return { source, ast, frontmatter, summary };
}

export function formatDiagnostics(error: FolioValidationError): string {
  return error.diagnostics.map((item) => {
    const location = item.line === null ? error.file : `${error.file}:${item.line}`;
    return `${location}\n\n${item.message}`;
  }).join("\n\n");
}
