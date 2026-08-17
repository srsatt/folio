import { REPORT_KINDS, type ReportKind } from "../types";

const SECTIONS: Record<ReportKind, string> = {
  investigation: `## Context

...

## Findings

{% finding title="Replace with finding" severity="medium" confidence="medium" %}

...

{% /finding %}

## Recommendations

...`,
  implementation: `## What changed

...

## Validation

...`,
  review: `## Findings

...

## Recommendations

...`,
  architecture: `## Context

...

## Decision

{% decision title="Replace with decision" status="proposed" %}

...

{% /decision %}

## Risks

...`,
  benchmark: `## Setup

...

## Results

...

## Limitations

...`,
  plan: `## Goal

...

## Proposed approach

...

## Risks

...`,
  incident: `## Impact

...

## Timeline

...

## Follow-up

...`,
  general: `## Details

...`,
};

export function isReportKind(value: string): value is ReportKind {
  return REPORT_KINDS.includes(value as ReportKind);
}

export function reportTemplate(kind: ReportKind): string {
  return `---
schema: folio/v1
title: Replace with report title
kind: ${kind}
tags: []
---

{% summary %}
Replace with a concise standalone summary.
{% /summary %}

${SECTIONS[kind]}
`;
}

export const FORMAT_GUIDE = `Folio Markdoc v1

Frontmatter
  schema: folio/v1
  title: 1-160 characters
  kind: investigation | implementation | review | architecture | benchmark | plan | incident | general
  tags: optional, up to 10
  supersedes: optional Folio report UUID

Body
  Start with exactly one {% summary %} block before any heading.
  Use headings ## through ####. H1, raw HTML, Markdown images, and nested custom blocks are forbidden.
  Normal links: http, https, mailto, or # anchors.

Tags
  summary, callout, finding, decision, recommendation, risk, evidence, details, file, media
  File paths are always relative to the Git root.
  Attach local image/video artifacts with:
    {% media path="artifacts/test.png" alt="Test result" caption="Browser result" /%}
  Refer to source files with:
    {% file path="src/auth.ts" lines="20-35" /%}

Example
---
schema: folio/v1
title: Refresh investigation
kind: investigation
tags: [authentication]
---

{% summary %}
Concurrent refreshes can exchange one token twice.
{% /summary %}

## Finding

{% finding title="Refresh race" severity="high" confidence="high" %}
Two requests enter the refresh path concurrently.
{% /finding %}
`;
