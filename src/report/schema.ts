import type { Schema } from "@markdoc/markdoc";

export const SEMANTIC_ID = /^[a-z][a-z0-9-]{0,63}$/;
export const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LINE_RANGE = /^\d+(?:-\d+)?$/;

export const TAG_ATTRIBUTES = {
  summary: {},
  callout: { type: ["note", "info", "warning", "danger", "success"], title: "string" },
  finding: {
    id: "id",
    title: "required-string",
    severity: ["info", "low", "medium", "high", "critical"],
    confidence: ["low", "medium", "high"],
  },
  decision: {
    id: "id",
    title: "required-string",
    status: ["proposed", "recommended", "accepted", "rejected"],
  },
  recommendation: {
    id: "id",
    title: "required-string",
    priority: ["low", "medium", "high"],
    effort: ["small", "medium", "large"],
  },
  risk: {
    id: "id",
    title: "required-string",
    severity: ["info", "low", "medium", "high", "critical"],
    likelihood: ["low", "medium", "high"],
  },
  evidence: {
    id: "id",
    title: "string",
    path: "path",
    lines: "lines",
    url: "url",
  },
  details: { title: "required-string", open: "boolean" },
  file: { path: "required-path", lines: "lines" },
  media: {
    path: "required-path",
    kind: ["image", "video"],
    alt: "string",
    caption: "string",
    title: "string",
  },
} as const;

export type FolioTagName = keyof typeof TAG_ATTRIBUTES;
export const FOLIO_TAGS = Object.keys(TAG_ATTRIBUTES) as FolioTagName[];
export const BLOCK_TAGS: FolioTagName[] = FOLIO_TAGS.filter((name) => name !== "file");

export const MARKDOC_TAG_SCHEMA: Record<FolioTagName, Schema> = {
  summary: { render: "section" },
  callout: {
    render: "aside",
    attributes: {
      type: { type: String, matches: ["note", "info", "warning", "danger", "success"], default: "note" },
      title: { type: String },
    },
  },
  finding: {
    render: "section",
    attributes: {
      id: { type: String },
      title: { type: String, required: true },
      severity: { type: String, matches: ["info", "low", "medium", "high", "critical"], default: "medium" },
      confidence: { type: String, matches: ["low", "medium", "high"], default: "medium" },
    },
  },
  decision: {
    render: "section",
    attributes: {
      id: { type: String },
      title: { type: String, required: true },
      status: { type: String, matches: ["proposed", "recommended", "accepted", "rejected"], default: "proposed" },
    },
  },
  recommendation: {
    render: "section",
    attributes: {
      id: { type: String },
      title: { type: String, required: true },
      priority: { type: String, matches: ["low", "medium", "high"], default: "medium" },
      effort: { type: String, matches: ["small", "medium", "large"], default: "medium" },
    },
  },
  risk: {
    render: "section",
    attributes: {
      id: { type: String },
      title: { type: String, required: true },
      severity: { type: String, matches: ["info", "low", "medium", "high", "critical"], default: "medium" },
      likelihood: { type: String, matches: ["low", "medium", "high"], default: "medium" },
    },
  },
  evidence: {
    render: "section",
    attributes: {
      id: { type: String },
      title: { type: String },
      path: { type: String },
      lines: { type: String },
      url: { type: String },
    },
  },
  details: {
    render: "details",
    attributes: {
      title: { type: String, required: true },
      open: { type: Boolean, default: false },
    },
  },
  file: {
    render: "code",
    selfClosing: true,
    inline: true,
    attributes: {
      path: { type: String, required: true },
      lines: { type: String },
    },
  },
  media: {
    render: "figure",
    selfClosing: true,
    attributes: {
      path: { type: String, required: true },
      kind: { type: String, matches: ["image", "video"] },
      alt: { type: String },
      caption: { type: String },
      title: { type: String },
    },
  },
};

export function isSafeLink(value: string): boolean {
  if (value.startsWith("#")) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function isSafeEvidenceUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isRepoRelativePath(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  const parts = value.split("/");
  return !parts.some((part) => !part || part === "." || part === "..");
}
