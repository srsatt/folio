# Folio Markdoc v1

## Frontmatter

Every report starts with:

```yaml
---
schema: folio/v1
title: Standalone title
kind: investigation
tags: [optional, tags]
---
```

Kinds: `investigation`, `implementation`, `review`, `architecture`, `benchmark`, `plan`, `incident`, `general`. Add `supersedes: <report UUID>` only when replacing an existing Folio report.

Title length: 1-160 characters. Use at most 10 unique tags, each 1-40 characters.

## Body contract

- Put exactly one `{% summary %}` block first, before headings. Keep it under 1200 characters.
- Use headings `##` through `####`; frontmatter supplies H1.
- Use paragraphs, emphasis, strong, inline/fenced code, blockquotes, lists, rules, tables, and safe links.
- Link only with `http`, `https`, `mailto`, or `#` URLs.
- Do not use raw HTML, Markdown images, arbitrary tags, nested custom block tags, or executable content.

## Semantic tags

```markdoc
{% summary %}Concise result.{% /summary %}

{% callout type="warning" title="Compatibility" %}...{% /callout %}

{% finding id="race" title="Requests race" severity="high" confidence="high" %}...{% /finding %}

{% decision id="single-flight" title="Serialize refresh" status="recommended" %}...{% /decision %}

{% recommendation id="test" title="Add concurrency test" priority="high" effort="small" %}...{% /recommendation %}

{% risk id="multi-process" title="Guard is process-local" severity="medium" likelihood="medium" %}...{% /risk %}

{% evidence id="source" title="Current implementation" path="src/auth.ts" lines="84-117" %}...{% /evidence %}

{% details title="Raw output" open=false %}...{% /details %}
```

IDs are optional, unique, and match `[a-z][a-z0-9-]{0,63}`.

Enums:

- callout type: `note`, `info`, `warning`, `danger`, `success`
- severity: `info`, `low`, `medium`, `high`, `critical`
- confidence, priority, likelihood: `low`, `medium`, `high`
- decision status: `proposed`, `recommended`, `accepted`, `rejected`
- effort: `small`, `medium`, `large`

## Repository file links

Use inline file references:

```markdoc
See {% file path="src/auth/session.ts" lines="84-117" /%}.
```

Use paths relative to Git root. Never use absolute paths, `.` segments, or `..` segments. Folio renders clickable local links and includes evidence locations in exported review feedback.

## Media attachments

Attach local image or video artifacts:

```markdoc
{% media path="artifacts/login-fixed.png" alt="Login page after fix" caption="Chrome acceptance result" /%}

{% media path="artifacts/interaction.mp4" kind="video" caption="Recorded interaction" /%}
```

Media paths are Git-root-relative. Folio reads them during creation and embeds their bytes as data URLs, so copied `report.html` remains complete and offline. Images require useful `alt` text. Optional attributes: `kind="image|video"`, `caption`, `title`.

## Minimal example

```markdoc
---
schema: folio/v1
title: Dependency cleanup
kind: implementation
tags: []
---

{% summary %}
Removed obsolete dependencies and simplified the build path.
{% /summary %}

## Changes

- Removed obsolete package.
- Updated {% file path="package.json" /%}.

## Validation

All tests pass.
```
