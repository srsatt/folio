# Implementation Prompt: Folio

You are a senior product engineer implementing a small local-first developer tool from scratch.

Build the project completely. Do not stop at an architecture proposal or pseudocode. Produce a working implementation, tests, examples, documentation, and a compact coding-agent skill.

The project should strongly prefer simplicity over extensibility.

When choosing between:

- a clever abstraction and a direct implementation;
- another dependency and 30 lines of straightforward code;
- a background service and a static file;
- a framework and browser DOM APIs;
- a generalized system and one explicit use case;

choose the simpler option unless there is a concrete reason not to.

The application is called **Folio**.

The CLI executable is:

```bash
folio
```

The package may be named:

```text
agent-folio
```

The primary runtime is **Bun**.

---

# 1. Product idea

Folio turns substantial coding-agent output into durable, readable, reviewable HTML reports.

The primary user experience is intentionally simple:

```text
coding agent
    ↓
structured Markdoc report
    ↓
folio create
    ↓
SQLite metadata + stored source + standalone HTML
    ↓
browser opens automatically
    ↓
user reads report
    ↓
user selects text and leaves inline comments
    ↓
Copy All Comments
    ↓
structured Markdown in clipboard
    ↓
paste back into coding agent
```

The crucial design constraint is:

> The entire primary review loop must work without any running server.

The user must be able to:

1. create a report;
2. open a standalone HTML file;
3. read it;
4. select text;
5. leave multiple inline comments;
6. edit or delete those comments;
7. copy all comments as structured Markdown;
8. paste that Markdown back into a coding agent;

without starting a daemon, HTTP server, database service, browser extension, MCP server, or any other background process.

SQLite is used as a local artifact catalog.

It is **not** the backend for inline comments in the primary flow.

---

# 2. Product philosophy

Folio is not:

- a documentation CMS;
- a collaborative review platform;
- a GitHub replacement;
- a Markdown editor;
- an agent framework;
- an MCP server;
- a long-running service;
- a web application requiring a backend;
- an attempt to build Notion locally.

Folio is a very small bridge between:

```text
agent output
```

and:

```text
human review
```

The desired feeling is:

> “The agent produced a report. It opened in my browser. I reviewed it like code, copied my comments, and pasted them back.”

Everything else is secondary.

---

# 3. Hard architectural rule: zero-server review

This requirement is non-negotiable.

The following command:

```bash
folio create report.mdoc
```

must be sufficient to perform the entire report review workflow.

`folio create` should:

1. read the source document;
2. validate it;
3. collect local Git metadata when available;
4. create a report ID;
5. store report metadata and source in SQLite;
6. store the source document in the Folio data directory;
7. render a self-contained HTML document;
8. store that HTML document in the Folio data directory;
9. attempt to open the HTML file in the default browser;
10. print concise report metadata to stdout.

No HTTP server is involved.

The generated HTML must contain everything required for:

- rendering;
- styling;
- inline annotations;
- comment editing;
- comment deletion;
- comment highlighting;
- comment export;
- clipboard support.

The HTML must work when opened directly with:

```text
file://
```

It must not use:

- `fetch()` for required functionality;
- backend APIs;
- WebSockets;
- remote scripts;
- remote fonts;
- remote CSS;
- CDNs;
- network requests.

A network connection should not be required at all.

---

# 4. Technology stack

Use:

- Bun;
- TypeScript;
- `strict: true`;
- `@markdoc/markdoc`;
- `bun:sqlite`;
- YAML parsing for frontmatter;
- vanilla browser JavaScript or TypeScript;
- regular CSS;
- `bun:test`.

Do not use:

- React;
- Vue;
- Svelte;
- Solid;
- Angular;
- Next.js;
- Remix;
- Astro;
- Vite;
- Tailwind;
- Hono;
- Express;
- Fastify;
- an ORM;
- GraphQL;
- Docker;
- Redis;
- a separate database process;
- an MCP SDK;
- a client-side state management library.

If keeping the browser annotation code as one small plain JavaScript file avoids an unnecessary frontend build system, that is acceptable.

Most of the codebase should still be TypeScript.

Do not introduce a frontend framework just to make a single static document interactive.

---

# 5. Storage layout

Resolve the Folio data directory in this order:

1. `FOLIO_HOME`
2. `$XDG_DATA_HOME/folio`
3. `~/.local/share/folio`

Example:

```text
~/.local/share/folio/
  folio.sqlite
  reports/
    4d15b9d8-a8cb-4d47-b636-f18bf309ed85/
      report.mdoc
      report.html
      meta.json
```

The working Git repository must remain untouched.

Do not write Folio reports into the current repository unless the user explicitly requests an export in some future version.

---

# 6. SQLite responsibilities

SQLite is a persistent catalog of reports.

It exists so that later the user can:

- list previous reports;
- search reports;
- reopen reports;
- inspect reports by repository;
- run an optional archive viewer.

SQLite is not required for browser-side review interactions after the HTML file has been produced.

Use:

```ts
import { Database } from "bun:sqlite";
```

Enable:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

Implement a tiny migration mechanism.

Do not use an ORM.

A reasonable initial schema is:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

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

CREATE INDEX reports_created_at_idx
  ON reports(created_at DESC);

CREATE INDEX reports_repo_key_idx
  ON reports(repo_key);

CREATE INDEX reports_kind_idx
  ON reports(kind);
```

Do not create a `comments` table in the MVP.

Browser review comments are intentionally independent from SQLite.

---

# 7. Immutable report model

A created report is immutable.

The following do not mutate an existing report:

- reviewing it;
- adding browser comments;
- copying feedback;
- reopening it;
- viewing it through the optional archive server.

If an agent produces an updated report, create a new report.

The new report may reference the previous report using:

```yaml
supersedes: <report-id>
```

Do not implement in-browser editing of report content.

---

# 8. Report source format

Folio uses a deliberately restricted subset of Markdoc.

Call the format:

```text
Folio Markdoc v1
```

Recommended extension:

```text
.mdoc
```

Plain `.md` files may also be accepted if they conform to the Folio document restrictions.

The purpose of Markdoc is to provide a middle layer between:

```text
plain Markdown
```

and:

```text
arbitrary HTML / JSX
```

The source must remain:

- human-readable;
- agent-friendly;
- declarative;
- deterministic;
- diffable;
- easy to validate;
- easy to render.

Do not allow arbitrary executable behavior in a report.

---

# 9. Folio Markdoc v1 document contract

This is an important part of the project.

Do not accept arbitrary Markdoc documents.

Every Folio report must follow a predictable document contract.

## 9.1 Required frontmatter

Every report must begin with YAML frontmatter.

Example:

```yaml
---
schema: folio/v1
title: Authentication refresh investigation
kind: investigation
tags:
  - authentication
  - concurrency
---
```

Required fields:

```ts
interface FolioFrontmatter {
  schema: "folio/v1";
  title: string;
  kind: ReportKind;

  tags?: string[];
  supersedes?: string;
}
```

Supported report kinds:

```ts
type ReportKind =
  | "investigation"
  | "implementation"
  | "review"
  | "architecture"
  | "benchmark"
  | "plan"
  | "incident"
  | "general";
```

Validation rules:

- `schema` must equal exactly `folio/v1`;
- `title` is required;
- title must contain between 1 and 160 characters after trimming;
- `kind` must be one of the supported values;
- at most 10 tags;
- each tag must contain between 1 and 40 characters;
- duplicate tags should be normalized away;
- `supersedes`, if present, must be a valid Folio report ID.

Unknown frontmatter fields should produce a validation warning or error.

Prefer strict validation.

---

# 10. Document body restrictions

After frontmatter, the first meaningful node must be exactly one `summary` block.

Example:

```markdoc
{% summary %}
The refresh flow allows duplicate token exchanges when multiple requests attempt to refresh the same session concurrently.
{% /summary %}
```

There must be exactly one summary block.

It must appear before the first heading.

Its plain-text content becomes the report summary stored in SQLite.

The summary should be reasonably short.

Recommended validation limit:

```text
1200 characters
```

Do not require the same summary to be duplicated in frontmatter.

---

# 11. Heading rules

The report title comes from frontmatter.

Therefore:

```markdown
# H1
```

is forbidden inside the body.

Allowed heading depths:

```markdown
## Section
### Subsection
#### Detail
```

Do not allow headings deeper than level 4.

This keeps reports structurally predictable.

---

# 12. Allowed regular Markdown

Support a conservative set of normal Markdown features:

- paragraphs;
- emphasis;
- strong emphasis;
- inline code;
- fenced code blocks;
- blockquotes;
- ordered lists;
- unordered lists;
- horizontal rules;
- links;
- headings level 2 through 4.

Tables may be supported if Markdoc supports them cleanly without adding another Markdown dialect dependency.

Do not add a plugin ecosystem merely to support extra Markdown syntax.

Images are out of scope for Folio v1.

Raw HTML is forbidden.

---

# 13. Link restrictions

Normal Markdown links may use:

```text
https:
http:
mailto:
#
```

Do not allow:

```text
javascript:
data:
file:
vbscript:
```

Relative links should either:

- be rejected;
- or produce a validation warning;

because the final report lives outside the source repository and relative links are likely to become misleading.

Repository file references should use the dedicated `file` tag instead.

---

# 14. Semantic Folio tags

Support exactly the following custom tags in Folio Markdoc v1:

```text
summary
callout
finding
decision
recommendation
risk
evidence
details
file
```

Unknown custom tags are validation errors.

Do not create a generic component system.

Do not allow arbitrary user-defined tags.

---

# 15. Semantic tag nesting restriction

For Folio v1:

> Custom block tags may not be nested inside other custom block tags.

This restriction is intentional.

It keeps:

- AST processing simple;
- rendering predictable;
- annotation anchors simple;
- output visually consistent.

Normal Markdown may exist inside custom blocks.

For example, this is valid:

```markdoc
{% finding title="Refresh requests can race" severity="high" %}

Two requests can refresh the same session concurrently.

```ts
await refreshSession(sessionId);
```

This can overwrite a newer value.

{% /finding %}
```

But this is invalid:

```markdoc
{% finding title="Refresh requests can race" %}

{% evidence path="src/auth/session.ts" %}
...
{% /evidence %}

{% /finding %}
```

Put the evidence block next to the finding instead.

---

# 16. Semantic IDs

The following tags may have an optional explicit `id`:

- finding;
- decision;
- recommendation;
- risk;
- evidence.

When provided, IDs must match:

```text
[a-z][a-z0-9-]{0,63}
```

Example:

```text
refresh-race
```

IDs must be unique within one report.

They are semantic identifiers, not database primary keys.

---

# 17. `summary`

Syntax:

```markdoc
{% summary %}
The implementation is correct overall, but session refreshes can race under concurrent traffic.
{% /summary %}
```

Rules:

- required exactly once;
- first meaningful body node;
- no attributes;
- may contain simple inline Markdown;
- should not contain headings;
- should not contain another custom tag.

Render it as a visually distinct executive-summary block.

---

# 18. `callout`

Example:

```markdoc
{% callout type="warning" title="Compatibility" %}
This behavior only exists in the legacy token flow.
{% /callout %}
```

Attributes:

```ts
type CalloutType =
  | "note"
  | "info"
  | "warning"
  | "danger"
  | "success";
```

Schema:

```ts
{
  type?: CalloutType; // default "note"
  title?: string;
}
```

---

# 19. `finding`

Example:

```markdoc
{% finding
   id="refresh-race"
   severity="high"
   confidence="high"
   title="Parallel refresh requests can race"
%}

Two requests can exchange the same refresh token concurrently.

{% /finding %}
```

Attributes:

```ts
type Severity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";

type Confidence =
  | "low"
  | "medium"
  | "high";
```

Schema:

```ts
{
  id?: string;
  title: string;
  severity?: Severity;     // default "medium"
  confidence?: Confidence; // default "medium"
}
```

---

# 20. `decision`

Example:

```markdoc
{% decision
   id="single-flight"
   status="recommended"
   title="Serialize refreshes per session"
%}

Use a single-flight promise keyed by session ID.

{% /decision %}
```

Attributes:

```ts
type DecisionStatus =
  | "proposed"
  | "recommended"
  | "accepted"
  | "rejected";
```

Schema:

```ts
{
  id?: string;
  title: string;
  status?: DecisionStatus; // default "proposed"
}
```

---

# 21. `recommendation`

Example:

```markdoc
{% recommendation
   id="concurrency-test"
   priority="high"
   effort="small"
   title="Add a concurrent refresh test"
%}

Run two refresh requests in parallel and verify that token exchange executes only once.

{% /recommendation %}
```

Attributes:

```ts
type Priority =
  | "low"
  | "medium"
  | "high";

type Effort =
  | "small"
  | "medium"
  | "large";
```

Schema:

```ts
{
  id?: string;
  title: string;
  priority?: Priority; // default "medium"
  effort?: Effort;     // default "medium"
}
```

---

# 22. `risk`

Example:

```markdoc
{% risk
   id="multi-process"
   severity="medium"
   likelihood="medium"
   title="An in-memory guard does not coordinate processes"
%}

Multiple application instances require a different coordination strategy.

{% /risk %}
```

Attributes:

```ts
type Likelihood =
  | "low"
  | "medium"
  | "high";
```

Schema:

```ts
{
  id?: string;
  title: string;
  severity?: Severity;     // default "medium"
  likelihood?: Likelihood; // default "medium"
}
```

---

# 23. `evidence`

Example:

```markdoc
{% evidence
   id="refresh-code"
   title="Current refresh implementation"
   path="src/auth/session.ts"
   lines="84-117"
%}

```ts
return sessionStore.replace(await refreshSession(token));
```

{% /evidence %}
```

Schema:

```ts
{
  id?: string;
  title?: string;
  path?: string;
  lines?: string;
  url?: string;
}
```

At least one of the following should normally exist:

- `path`;
- `url`;
- body content.

Validate URL schemes.

`path` is metadata only.

Do not attempt to read arbitrary files while rendering the report.

---

# 24. `details`

Example:

```markdoc
{% details title="Raw benchmark output" %}

```text
baseline: 18.4 ms
candidate: 11.2 ms
```

{% /details %}
```

Schema:

```ts
{
  title: string;
  open?: boolean; // default false
}
```

Render using native:

```html
<details>
```

---

# 25. Inline `file`

Example:

```markdoc
The behavior originates in {% file path="src/auth/session.ts" lines="84-117" /%}.
```

Schema:

```ts
{
  path: string;
  lines?: string;
}
```

Render it as a compact code-style file reference.

For MVP, it does not have to open the editor.

If repository metadata permits generating a safe GitHub/GitLab source URL without network access, that may be added later.

Do not overbuild this feature now.

---

# 26. Recommended report structures

Do not make these section names hard validation requirements.

They are guidance for agents and templates.

## Investigation

Recommended shape:

```text
summary
Context
Findings
Evidence
Recommendations
Risks / Unknowns
```

## Implementation

Recommended shape:

```text
summary
What changed
Important implementation details
Validation
Tradeoffs
Remaining work
```

## Review

Recommended shape:

```text
summary
Findings
Questions
Recommendations
```

## Architecture

Recommended shape:

```text
summary
Context
Constraints
Decision
Alternatives considered
Risks
```

## Benchmark

Recommended shape:

```text
summary
Setup
Results
Interpretation
Limitations
```

## Plan

Recommended shape:

```text
summary
Goal
Constraints
Proposed approach
Steps
Risks
```

Do not force empty boilerplate sections.

Reports should contain only sections that add information.

---

# 27. `folio template`

Implement:

```bash
folio template <kind>
```

Examples:

```bash
folio template investigation
folio template implementation
folio template architecture
```

The command prints a small valid Folio Markdoc skeleton to stdout.

This exists primarily for coding agents.

It prevents the agent skill from needing to contain the entire report schema.

Example output:

```markdoc
---
schema: folio/v1
title: Replace with report title
kind: investigation
tags: []
---

{% summary %}
Replace with a concise standalone summary.
{% /summary %}

## Context

...

## Findings

{% finding
   severity="medium"
   confidence="medium"
   title="Replace with finding"
%}

...

{% /finding %}

## Recommendations

...
```

Keep templates concise.

---

# 28. `folio format`

Implement:

```bash
folio format
```

This should print a concise agent-oriented cheat sheet for Folio Markdoc v1.

It should include:

- frontmatter fields;
- body restrictions;
- allowed tags;
- one short example.

It should not dump a giant manual.

This provides progressive disclosure:

```text
skill
  ↓ if necessary
folio format
  ↓ if necessary
folio template <kind>
```

The default coding-agent context therefore stays small.

---

# 29. Validation

Implement:

```bash
folio validate report.mdoc
folio validate -
folio validate report.mdoc --json
```

Validation must catch:

- missing frontmatter;
- incorrect schema;
- missing title;
- missing kind;
- unknown kind;
- unknown frontmatter fields;
- missing summary;
- multiple summaries;
- summary in the wrong position;
- H1 usage;
- heading deeper than H4;
- raw HTML;
- images;
- unknown custom tags;
- unknown tag attributes;
- missing required tag attributes;
- invalid enum values;
- invalid semantic IDs;
- duplicate semantic IDs;
- nested custom blocks;
- unsafe URL schemes.

Errors should be actionable.

Human-readable example:

```text
report.mdoc:28

Invalid `finding.severity`.

Expected one of:
info, low, medium, high, critical

Received:
urgent
```

Use source line information when reasonably available.

Do not build an elaborate compiler diagnostic framework.

A straightforward error type is enough.

---

# 30. Report creation

Support:

```bash
folio create report.mdoc
```

and:

```bash
cat report.mdoc | folio create -
```

and:

```bash
folio create --stdin
```

Useful options:

```text
--no-open
--json
--supersedes <id>
```

Most metadata should come from the document or environment rather than CLI flags.

`folio create` performs validation automatically.

An invalid document must not be stored as a report.

---

# 31. Default browser behavior

The normal behavior is:

```bash
folio create report.mdoc
```

→ create report  
→ render HTML  
→ open browser.

Do not require:

```bash
folio create --open
```

Opening is the default.

Provide:

```bash
--no-open
```

for automation or CI.

Opening failures must not cause report creation to fail.

Attempt:

- macOS: `open`;
- Linux: `xdg-open`;
- Windows: an appropriate native command.

Do not add a dependency merely to open a file.

If opening fails:

1. keep the report;
2. print the HTML path;
3. return success if report creation itself succeeded.

---

# 32. Git metadata

When `folio create` runs inside a Git repository, collect:

- repository root;
- origin remote;
- current branch;
- HEAD commit;
- dirty state.

Use the system `git` executable.

Do not add a Git library.

Example:

```ts
interface GitMetadata {
  root: string | null;
  remote: string | null;
  repoKey: string | null;
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
}
```

Normalize common remote formats into a repository key.

For example:

```text
git@github.com:owner/repo.git
```

and:

```text
https://github.com/owner/repo.git
```

should both normalize to:

```text
github.com/owner/repo
```

Do not make network requests.

Creation outside Git must work normally.

---

# 33. Report identity

Use:

```ts
crypto.randomUUID()
```

for report IDs.

Normalize line endings to:

```text
\n
```

before calculating a content hash.

Use SHA-256.

Store:

```text
sha256:<hex>
```

The content hash is useful for:

- detecting stale browser review state;
- localStorage namespacing;
- debugging;
- integrity.

---

# 34. Stored metadata

Create:

```text
meta.json
```

next to the report.

Example:

```json
{
  "schemaVersion": 1,
  "id": "4d15b9d8-a8cb-4d47-b636-f18bf309ed85",
  "title": "Authentication refresh investigation",
  "kind": "investigation",
  "summary": "The refresh flow allows duplicate token exchanges under concurrent requests.",
  "tags": [
    "authentication",
    "concurrency"
  ],
  "createdAt": "2026-08-17T14:00:00.000Z",
  "contentHash": "sha256:...",
  "repository": {
    "key": "github.com/example/project",
    "root": "/path/to/project",
    "remote": "git@github.com:example/project.git",
    "branch": "feature/auth",
    "commit": "0123456789abcdef",
    "dirty": true
  },
  "supersedes": null
}
```

The database and metadata file intentionally duplicate some information.

The files should remain understandable even if the SQLite database is lost.

---

# 35. Standalone HTML

The generated `report.html` is a first-class artifact.

It must be a complete standalone HTML document.

It must contain inline:

- document CSS;
- review UI CSS;
- annotation JavaScript;
- report metadata required by the browser client.

It must not depend on adjacent assets.

Copying only:

```text
report.html
```

to another directory should still produce a readable and reviewable document.

Do not load anything from the Internet.

---

# 36. HTML appearance

The page should look like a polished technical document.

Priorities:

1. readability;
2. hierarchy;
3. code readability;
4. restrained semantic emphasis;
5. review interaction.

Use:

- system fonts;
- a comfortable content width;
- generous line height;
- sensible heading spacing;
- good code blocks;
- responsive layout;
- light and dark mode through `prefers-color-scheme`;
- print-friendly styles.

Avoid:

- excessive cards;
- gradients;
- glassmorphism;
- giant dashboard headers;
- unnecessary animations;
- decorative UI noise.

The report should still feel primarily like a document.

---

# 37. Report header

Show:

- title;
- report kind;
- tags;
- creation time;
- repository key when present;
- branch;
- short commit SHA;
- dirty indicator when relevant.

Keep metadata visually secondary to the report title.

Also provide a compact button:

```text
Copy report path
```

if easy to implement.

This is optional.

---

# 38. Annotatable blocks

The renderer should mark useful textual blocks with deterministic DOM metadata.

Example:

```html
<p
  data-folio-block-id="b-0012"
  data-folio-annotatable
>
  ...
</p>
```

Annotatable content should include at least:

- paragraphs;
- headings;
- list items;
- blockquotes;
- code blocks;
- semantic block bodies.

IDs only need to be deterministic for the same source document.

A simple render-order ID is acceptable:

```text
b-0001
b-0002
b-0003
```

because reports are immutable.

Do not create a complicated content-addressable tree identity system.

---

# 39. Review interaction

The review interaction should resemble a lightweight code review.

Main flow:

1. User selects text in the report.
2. A small floating `Comment` action appears near the selection.
3. User activates it.
4. A compact comment editor opens.
5. The selected quote is shown as context.
6. User writes feedback.
7. User saves.
8. The selected text becomes highlighted.
9. A comment card appears associated with that block.
10. User continues reading and commenting.

Do not require a server.

---

# 40. Selection restrictions

Keep selection behavior intentionally limited in Folio v1.

An inline comment selection must remain inside one annotatable block.

For example, valid:

- part of one paragraph;
- one sentence;
- part of a heading;
- several lines inside one code block;
- text inside one list item.

Invalid:

- selection starting in one paragraph and ending in another;
- selection spanning several cards;
- selection crossing document UI.

When selection crosses blocks, show a small non-disruptive message:

```text
Select text within a single block to comment.
```

This restriction dramatically simplifies annotation anchoring.

Keep it.

---

# 41. Overlapping selections

Do not support overlapping inline comment ranges in Folio v1.

If a new selection intersects an existing comment highlight, reject it and show:

```text
This selection overlaps an existing comment.
```

The user can select a smaller range.

This avoids complex DOM range composition.

---

# 42. Comment model

The browser-side model should be minimal.

Example:

```ts
interface ReviewComment {
  id: string;

  blockId: string;
  startOffset: number;
  endOffset: number;

  selectedText: string;
  body: string;

  sectionTitle: string | null;

  createdAt: string;
  updatedAt: string;
}
```

Use browser UUID generation where available.

Do not add:

- comment types;
- severity;
- threads;
- replies;
- resolved state;
- reactions;
- authors;
- permissions;
- synchronization metadata.

A comment is simply:

```text
selected report text
+
human feedback
```

---

# 43. Text offsets

Offsets should be measured relative to normalized textual content of the annotatable block.

Implement helper functions for:

- converting a DOM Range into character offsets;
- restoring a DOM Range from character offsets;
- verifying `selectedText`.

Store:

```text
blockId
startOffset
endOffset
selectedText
```

This is sufficient because the report itself is immutable.

If restoration fails, retain the comment in the comment list without a highlight.

Do not implement a sophisticated fuzzy annotation standard in MVP.

---

# 44. Comment rendering

When a comment exists:

- highlight the referenced text;
- show a small numbered marker;
- render a compact comment card directly below or adjacent to its block.

A simple inline layout is preferable to an elaborate right-margin positioning engine.

Each comment card should show:

- comment number;
- selected quote;
- comment body;
- Edit;
- Delete.

Example:

```text
Comment 3

“single-flight promise keyed by session ID”

This only works inside one process. Please mention that explicitly.

Edit · Delete
```

The report must remain comfortable to read even with many comments.

---

# 45. Adding comments

Use native browser capabilities where possible.

A simple implementation may use:

```html
<dialog>
```

for the editor.

The editor contains:

- selected quote;
- textarea;
- Save;
- Cancel.

Useful keyboard behavior:

```text
Escape
```

closes the editor.

Optionally:

```text
Cmd/Ctrl + Enter
```

saves the comment.

Do not spend significant code on modal infrastructure.

---

# 46. Editing and deleting comments

Users must be able to:

- edit comment text;
- delete a comment.

Deleting must also remove its highlight.

A simple browser `confirm()` before deletion is acceptable.

Do not build a custom confirmation modal unless necessary.

---

# 47. Browser-side comment persistence

The core workflow must not depend on persistence.

The authoritative state for a review session may simply live in memory in the currently open page.

However, implement best-effort browser persistence using:

```text
localStorage
```

when available.

Use a namespaced key such as:

```text
folio:review:<report-id>:<content-hash>
```

Persist the review state after:

- adding;
- editing;
- deleting.

Wrap all storage access in `try/catch`.

If browser storage is unavailable:

- the report must still work;
- adding comments must still work;
- editing must still work;
- deleting must still work;
- Copy All Comments must still work.

Show a subtle note if necessary:

```text
Comments will last for this tab only.
```

Do not make localStorage availability an error.

Do not use IndexedDB unless there is a concrete reason.

Do not implement browser filesystem APIs.

---

# 48. Content hash and saved comments

When restoring comments from localStorage:

1. use a storage key containing the report ID and content hash;
2. verify expected structure;
3. discard malformed entries safely;
4. never execute stored HTML;
5. treat comment body as plain text.

Because a new report revision has a new report ID and content hash, review comments naturally remain attached to the original report.

Do not migrate comments automatically between report versions.

---

# 49. Review toolbar

Provide a small sticky or floating review toolbar.

It should contain:

```text
N comments
Copy All Comments
Download Comments.md
Clear
```

`Clear` may be visually secondary.

When there are no comments:

```text
Copy All Comments
```

should be disabled or explain that there is nothing to copy.

Do not turn the toolbar into a dashboard.

---

# 50. Copy All Comments

This is one of the most important product features.

The button:

```text
Copy All Comments
```

must generate structured Markdown and put it into the system clipboard.

The resulting text is designed to be pasted directly into a coding agent.

It should not be a dump of internal JSON.

It should be easy for both humans and LLMs to understand.

---

# 51. Feedback Markdown format

Generate approximately:

```markdown
# Review feedback: Authentication refresh investigation

I reviewed Folio report `4d15b9d8-a8cb-4d47-b636-f18bf309ed85`.

Please address every comment below.

After addressing the feedback, briefly explain what changed and create a new Folio report if the report itself needs to be updated.

## Context

- Repository: `github.com/example/project`
- Branch: `feature/auth`
- Commit: `0123456`
- Report ID: `4d15b9d8-a8cb-4d47-b636-f18bf309ed85`

## Comment 1

**Section:** Findings

> Two requests can exchange the same refresh token concurrently.

This sounds process-local. Please clarify what happens when there are multiple application instances.

## Comment 2

**Section:** Recommendations

> Add a concurrent refresh test.

Please also test the case where the first refresh request fails.

## Comment 3

**Section:** Risks

> distributed coordination

I don't think we need to solve this now, but call it out explicitly as a non-goal.
```

If repository metadata is absent, omit those fields.

Do not emit empty metadata lines.

---

# 52. Feedback ordering

Comments should be exported in document order.

For comments on the same block:

- sort by start offset;
- then creation order.

Number them sequentially:

```text
Comment 1
Comment 2
Comment 3
```

The browser UUID does not need to appear in normal Markdown output.

---

# 53. Section context

When creating a comment, determine the nearest preceding heading.

Store its plain text as:

```ts
sectionTitle
```

Example:

```text
Recommendations
```

If the selected block is inside a semantic Folio element, optionally include useful semantic context.

For example:

```text
Finding: Parallel refresh requests can race
```

Do not create a complicated ancestry representation.

One concise context label is enough.

---

# 54. Evidence context

If a comment is attached to content inside an `evidence` block containing:

```text
path
lines
```

the exported Markdown may additionally include:

```markdown
**Evidence:** `src/auth/session.ts:84-117`
```

This is useful agent context.

Implement this only if it falls out naturally from the renderer metadata.

Do not create complex code-reference machinery for it.

---

# 55. Clipboard fallback

Use the Clipboard API when available.

If clipboard writing fails:

1. show a dialog or textarea containing the generated Markdown;
2. select the text;
3. let the user copy it manually.

Do not lose the generated feedback because browser clipboard permission failed.

---

# 56. Download Comments.md

Provide a secondary action:

```text
Download Comments.md
```

It should generate the exact same Markdown as `Copy All Comments`.

Use a browser Blob and temporary download link.

Suggested filename:

```text
<report-slug>-review.md
```

Do not require a server.

---

# 57. Clear comments

Provide:

```text
Clear
```

It should:

1. ask for confirmation;
2. remove all in-memory comments;
3. remove saved localStorage review state for this report;
4. remove highlights and cards.

Do not affect the Folio report itself.

---

# 58. HTML safety

The source report must be treated as untrusted text.

Requirements:

- raw HTML is forbidden;
- arbitrary scripts are forbidden;
- custom tags are allowlisted;
- custom attributes are validated;
- URLs are validated;
- text is HTML escaped;
- comments are inserted using DOM text APIs;
- never put comment text into `innerHTML`;
- never execute content from the report;
- never execute content from localStorage.

The only JavaScript in the report should be Folio's own generated review client.

---

# 59. No external resources

The standalone report must not automatically load:

- analytics;
- images;
- avatars;
- fonts;
- syntax highlighter assets;
- JavaScript;
- CSS;
- repository files;
- GitHub content;
- API data.

It should be genuinely self-contained.

---

# 60. Syntax highlighting

Syntax highlighting is optional for the MVP.

Readable fenced code blocks are required.

Do not add a large syntax-highlighting dependency unless the implementation remains trivial.

A clean `<pre><code>` is better than unnecessary complexity.

---

# 61. Staleness display

Because the report stores Git metadata, `folio open` may optionally calculate current repository state before opening.

However, do not modify the static HTML every time.

For MVP, it is enough that the report header displays:

```text
Generated from commit abc1234
```

More advanced staleness detection can be implemented by the optional archive viewer.

Do not make it part of the critical path.

---

# 62. CLI commands

Implement at least:

```text
folio create
folio validate
folio template
folio format
folio list
folio show
folio open
folio serve
folio path
```

Keep command behavior obvious.

---

# 63. `folio list`

Examples:

```bash
folio list
folio list --repo github.com/example/project
folio list --kind investigation
folio list --limit 20
folio list --json
```

Default ordering:

```text
created_at DESC
```

Human output can be a simple readable list.

Do not spend time implementing an elaborate terminal table.

---

# 64. `folio show`

Examples:

```bash
folio show <report-id>
folio show <report-id> --source
folio show <report-id> --json
```

Default output:

```text
Title
Kind
Created
Repository
Branch
Commit
Source path
HTML path
```

`--source` prints the stored Markdoc.

---

# 65. `folio open`

Examples:

```bash
folio open <report-id>
folio open latest
```

It should open the stored standalone HTML file directly.

It must not require the Folio server.

---

# 66. `folio path`

```bash
folio path
```

Print the resolved Folio data directory.

Useful for debugging and backups.

---

# 67. Optional archive server

Implement a deliberately tiny optional command:

```bash
folio serve
```

Default:

```text
127.0.0.1:7331
```

Purpose:

> Browse previous reports.

Nothing more.

The archive server is not part of report creation or review.

---

# 68. Archive server scope

The server may support only:

```text
GET /
GET /r/:reportId
GET /health
```

`GET /`:

- queries SQLite;
- displays previous reports;
- provides simple filtering/search;
- links to each report.

`GET /r/:reportId`:

- serves the already generated standalone report HTML.

`GET /health`:

```json
{
  "ok": true
}
```

Do not create:

- comment APIs;
- report mutation APIs;
- WebSockets;
- authentication;
- sessions;
- synchronization endpoints.

The server should be effectively read-only.

---

# 69. Archive page

The archive list should show:

- title;
- summary;
- report kind;
- tags;
- repository;
- branch;
- short commit;
- creation date.

Provide lightweight search/filtering.

This can be server-rendered HTML plus a few lines of browser JavaScript.

No frontend framework.

---

# 70. Network binding

`folio serve` should bind only to:

```text
127.0.0.1
```

by default.

If custom network binding is supported, require an explicit flag such as:

```bash
folio serve --host 0.0.0.0 --allow-network
```

Do not accidentally expose local reports to the network.

---

# 71. Important distinction: browser review state vs archive

Review comments created when opening:

```text
file:///.../report.html
```

are browser-local review state.

The archive server does not need to know about them.

If the same report is later opened through:

```text
http://127.0.0.1:7331/r/...
```

browser storage may be different.

That is acceptable in the MVP.

Do not attempt to synchronize those states.

The durable handoff mechanism is:

```text
Copy All Comments
```

or:

```text
Download Comments.md
```

That is the product.

---

# 72. Agent skill design

The coding-agent skill must be very small.

Avoid putting the complete Folio Markdoc schema in the main skill.

Use progressive disclosure.

Suggested structure:

```text
skills/
  folio-report/
    SKILL.md
    references/
      format.md
```

`SKILL.md` should be roughly 1-2 KB.

`references/format.md` may contain the full Folio Markdoc v1 reference.

The skill should tell the agent to consult the reference only when necessary.

---

# 73. Suggested `SKILL.md`

Create something close to:

```markdown
---
name: folio-report
description: Create a durable, reviewable HTML report for substantial investigations, implementations, architecture work, benchmarks, plans, or reviews. Use when the user would benefit from reading and commenting on the result outside terminal output. Do not use for brief answers or routine status updates.
---

# Folio report

Use Folio for substantial human-readable work products.

Write a valid Folio Markdoc report and pass it to:

    folio create --stdin

`folio create` validates, stores, renders, and opens the report automatically.

Use normal Markdown for ordinary prose. Use Folio semantic blocks only where they make the report easier to scan.

For unfamiliar or complex report structures, run:

    folio template <kind>

or consult:

    references/format.md

Do not generate HTML yourself.

Do not include report IDs, timestamps, repository paths, branches, commits, or other Git metadata in the document. Folio collects those automatically.

The report must stand alone without requiring the conversation transcript.

After creating the report, keep the terminal response concise. Mention that the report was created and include its path or ID. Do not repeat the full report in terminal output.
```

Keep it compact.

---

# 74. Agent report generation strategy

The skill should encourage agents to choose the simplest valid representation.

For example:

Simple report:

```markdoc
---
schema: folio/v1
title: Dependency cleanup
kind: implementation
tags: []
---

{% summary %}
Removed three obsolete dependencies and simplified the build path.
{% /summary %}

## Changes

- Removed ...
- Replaced ...

## Validation

Tests pass.
```

Complex report:

```markdoc
---
schema: folio/v1
title: Session refresh investigation
kind: investigation
tags:
  - authentication
  - concurrency
---

{% summary %}
The current refresh path allows duplicate token exchanges under concurrent requests.
{% /summary %}

## Findings

{% finding
   severity="high"
   confidence="high"
   title="Parallel refresh requests can race"
%}

...

{% /finding %}

## Recommendation

{% recommendation
   priority="high"
   effort="small"
   title="Serialize refreshes per session"
%}

...

{% /recommendation %}
```

Semantic blocks are optional tools, not mandatory decoration.

---

# 75. Example report

Create:

```text
examples/auth-investigation.mdoc
```

Use a realistic report demonstrating:

- frontmatter;
- summary;
- headings;
- code block;
- finding;
- evidence;
- decision;
- recommendation;
- risk;
- details;
- inline file reference.

Ensure it passes all validation.

Use it in integration tests.

---

# 76. Example content

The example can follow this general shape:

````markdoc
---
schema: folio/v1
title: Authentication refresh flow investigation
kind: investigation
tags:
  - authentication
  - concurrency
  - architecture
---

{% summary %}
The current refresh flow allows multiple concurrent requests to exchange the same refresh token, potentially causing redundant work and inconsistent session replacement.
{% /summary %}

## Context

Session refresh is triggered independently by each request.

The relevant code lives in {% file path="src/auth/session.ts" lines="84-117" /%}.

## Findings

{% finding
   id="refresh-race"
   severity="high"
   confidence="high"
   title="Parallel refresh requests can race"
%}

Two requests can read the same expired session and initiate token exchange independently.

```ts
const current = await sessionStore.read(token);

if (current.expired) {
  return sessionStore.replace(await refreshSession(token));
}
```

The later write may replace state created by the earlier request.

{% /finding %}

{% evidence
   id="refresh-code"
   title="Current refresh implementation"
   path="src/auth/session.ts"
   lines="84-117"
%}

The refresh operation has no request-level or session-level coordination.

{% /evidence %}

## Recommended approach

{% decision
   id="single-flight"
   status="recommended"
   title="Serialize refreshes per session"
%}

Use a single-flight promise keyed by session ID.

Independent sessions should remain fully concurrent.

{% /decision %}

{% recommendation
   id="concurrency-test"
   priority="high"
   effort="small"
   title="Add a concurrent refresh test"
%}

Start two refresh operations for one session and verify that token exchange executes once.

{% /recommendation %}

## Risks

{% risk
   id="multi-process"
   severity="medium"
   likelihood="medium"
   title="In-memory coordination is process-local"
%}

This solution does not coordinate multiple application processes.

{% /risk %}

{% details title="Raw observations" %}

```text
single request: 43 ms
two concurrent requests: 78 ms
token exchange calls: 2
```

{% /details %}
````

---

# 77. Suggested project structure

Prefer a compact structure approximately like:

```text
src/
  cli.ts
  config.ts
  types.ts

  db.ts
  storage.ts
  git.ts

  report/
    parse.ts
    validate.ts
    schema.ts
    render.ts
    templates.ts

  feedback/
    types.ts
    markdown.ts

  web/
    review.js
    review.css

  server.ts

skills/
  folio-report/
    SKILL.md
    references/
      format.md

examples/
  auth-investigation.mdoc

tests/
  report.test.ts
  validation.test.ts
  storage.test.ts
  feedback.test.ts
  cli.test.ts
  server.test.ts
```

Do not mechanically split code into tiny modules.

If two files are clearer than ten, use two.

---

# 78. Rendering architecture

Avoid having two different report renderers.

Prefer:

```text
Markdoc source
    ↓
validated AST
    ↓
article HTML
    ↓
standalone shell
```

The standalone shell embeds:

- metadata;
- article;
- CSS;
- annotation client.

The optional archive server simply serves that same HTML file.

Do not rerender the report differently for the server.

---

# 79. Annotation metadata in HTML

Each annotatable block should contain enough information for the static review client.

Example:

```html
<p
  data-folio-block-id="b-0012"
  data-folio-annotatable="true"
  data-folio-section="Findings"
>
  Two requests can refresh the same session concurrently.
</p>
```

Semantic blocks may additionally expose:

```html
data-folio-context-kind="finding"
data-folio-context-title="Parallel refresh requests can race"
```

Evidence may expose:

```html
data-folio-path="src/auth/session.ts"
data-folio-lines="84-117"
```

Do not expose anything unnecessary.

---

# 80. Review client architecture

Keep the browser code small.

A reasonable state model:

```ts
interface ReviewState {
  version: 1;
  reportId: string;
  contentHash: string;
  comments: ReviewComment[];
}
```

Core functions should roughly correspond to:

```text
loadState
saveState
captureSelection
rangeToOffsets
offsetsToRange
addComment
editComment
deleteComment
renderComments
buildFeedbackMarkdown
copyFeedback
downloadFeedback
clearComments
```

Do not introduce an event bus or state-management abstraction.

---

# 81. Static HTML smoke requirement

A generated HTML report must remain fully functional after this operation:

```bash
cp report.html /tmp/report.html
open /tmp/report.html
```

The user must still be able to:

- read it;
- add comments;
- edit comments;
- delete comments;
- copy all comments;
- download comments Markdown.

This is an explicit acceptance test.

---

# 82. Main zero-server acceptance test

This is the most important end-to-end scenario.

Ensure no Folio server is running.

Then:

```bash
folio create examples/auth-investigation.mdoc
```

Expected:

1. report validates;
2. report is inserted into SQLite;
3. report files are created;
4. default browser opens the standalone HTML;
5. user can select a sentence;
6. user can click Comment;
7. user can write feedback;
8. highlight appears;
9. user can create several comments;
10. `Copy All Comments` copies structured Markdown;
11. the resulting Markdown can be pasted into a terminal or editor;
12. no network request or backend interaction was required.

If this scenario fails without `folio serve`, the implementation is incorrect.

---

# 83. Tests

Use:

```text
bun:test
```

Tests must never use the real Folio home directory.

Set a temporary:

```text
FOLIO_HOME
```

for each relevant test suite.

Test at least:

## Parsing and validation

- valid minimal report;
- valid complex report;
- missing frontmatter;
- wrong schema;
- missing title;
- invalid kind;
- missing summary;
- two summary blocks;
- summary after heading;
- H1 forbidden;
- H5 forbidden;
- unknown custom tag;
- unknown attribute;
- invalid enum;
- duplicate semantic ID;
- nested custom blocks;
- raw HTML rejected;
- image rejected;
- unsafe URL rejected.

## Rendering

- standalone HTML generated;
- source content escaped;
- styles embedded;
- review JavaScript embedded;
- no remote scripts;
- no remote stylesheet;
- report metadata rendered;
- annotatable block IDs generated;
- semantic metadata rendered;
- example report renders.

## Storage

- SQLite database created;
- report inserted;
- source text stored;
- source file written;
- HTML file written;
- meta file written;
- report ID stable within one record;
- content hash calculated;
- repository worktree remains untouched.

## Git

Use a temporary Git repository.

Test:

- repository root;
- branch;
- commit;
- dirty state;
- remote normalization;
- operation outside a Git repository.

No network required.

## Feedback Markdown

The Markdown generation logic should be a pure reusable function.

Test:

- comments in document order;
- selected quote included;
- body included;
- section included;
- repository context included when present;
- missing metadata omitted cleanly;
- multiline selected text quoted correctly;
- multiline comment rendered correctly.

## CLI

Test:

```text
folio validate
folio create --no-open
folio list
folio show
folio template
folio format
folio path
```

Do not attempt to launch a real browser from automated tests.

Inject or isolate the opener logic.

## Archive server

If implemented:

- `/health`;
- `/`;
- `/r/:id`;
- unknown report returns 404.

Do not test comment APIs because there must not be comment APIs.

---

# 84. Browser interaction testing

Do not add Playwright, Selenium, Puppeteer, or a browser automation framework solely for the MVP unless browser behavior becomes impossible to validate otherwise.

Keep pure logic such as:

```text
feedback generation
sorting
storage serialization
comment validation
```

outside DOM-heavy code where practical.

Manual browser smoke testing is acceptable for the actual text-selection interaction.

---

# 85. CLI output

Default `folio create` output should be concise.

Example:

```text
Created Folio report

Authentication refresh flow investigation
4d15b9d8-a8cb-4d47-b636-f18bf309ed85

HTML:
~/.local/share/folio/reports/4d15b9d8-a8cb-4d47-b636-f18bf309ed85/report.html

Git:
github.com/example/project @ 0123456

Opened in browser.
```

For agent integration support:

```bash
folio create --stdin --json
```

Example:

```json
{
  "id": "4d15b9d8-a8cb-4d47-b636-f18bf309ed85",
  "title": "Authentication refresh flow investigation",
  "htmlPath": "/Users/user/.local/share/folio/reports/.../report.html",
  "contentHash": "sha256:...",
  "opened": true
}
```

Do not return the entire report body in JSON.

---

# 86. Error handling

Errors should be boring and understandable.

Examples:

```text
folio: report validation failed
```

```text
folio: could not open browser; report was created successfully
HTML: /path/to/report.html
```

```text
folio: report not found: abc
```

Do not expose giant stack traces for expected user errors.

A debug mode is optional.

---

# 87. Atomic creation

Avoid creating half-written reports.

A reasonable strategy:

1. validate source;
2. generate metadata;
3. render HTML in memory;
4. create temporary report directory;
5. write source;
6. write HTML;
7. write metadata;
8. rename directory into final location;
9. insert SQLite row;
10. open browser.

If database insertion fails after directory creation, clean up if practical.

Do not implement a transaction coordinator.

---

# 88. Security and privacy

Folio is intended for local development reports and may contain sensitive code details.

Therefore:

- no telemetry;
- no analytics;
- no network calls;
- no remote font requests;
- no automatic GitHub API access;
- no cloud storage;
- no report upload;
- no AI API;
- no MCP connection;
- no hidden background process.

Everything should remain local unless the user explicitly copies or exports it.

---

# 89. README

Write a useful README.

It should include:

- what Folio is;
- the zero-server workflow;
- installation;
- quick start;
- example report;
- Folio Markdoc overview;
- inline review workflow;
- `Copy All Comments`;
- CLI commands;
- storage location;
- optional archive server;
- coding-agent skill;
- development commands;
- security model;
- MVP limitations.

The quick start should look approximately like:

```bash
bun install

bun run src/cli.ts create examples/auth-investigation.mdoc
```

Then explain:

```text
The report opens as a standalone HTML file.

Select text → Comment → write feedback → Copy All Comments.
```

Only after that introduce:

```bash
folio serve
```

as an optional archive browser.

The README must not make the server look required.

---

# 90. MVP non-goals

Explicitly do not implement:

- MCP;
- AI calls;
- LLM orchestration;
- cloud hosting;
- user accounts;
- authentication;
- collaborative comments;
- comment threads;
- replies;
- comment resolution workflow;
- server-side comment storage;
- SQLite comment storage;
- syncing comments;
- file watchers;
- background daemon;
- Git hooks;
- automatic report regeneration;
- browser-based report editing;
- arbitrary Markdoc extensions;
- MDX;
- JSX;
- raw HTML;
- custom JavaScript in reports;
- images;
- PDF generation;
- DOCX generation;
- GitHub PR integration;
- GitLab API integration;
- editor integrations;
- comment migration between report revisions;
- overlapping comments;
- cross-block comments;
- real-time features;
- browser filesystem APIs;
- full-text search;
- syntax highlighting as a required feature.

If something is in this list, do not implement it “because it might be useful later.”

---

# 91. Code quality

Use:

- TypeScript strict mode;
- small domain types;
- explicit validation;
- parameterized SQL;
- simple functions;
- clear naming;
- minimal dependencies;
- no unexplained `any`;
- no giant framework-shaped abstractions.

Avoid:

```text
Manager
Provider
Registry
Factory
Adapter
ServiceContainer
EventBus
RepositoryFactory
PluginSystem
```

unless the problem genuinely requires one.

This application should remain understandable by reading a few files.

---

# 92. Dependency philosophy

Before adding any dependency, ask:

> Does this library remove enough real code to justify its permanent presence?

Good dependency candidates:

```text
@markdoc/markdoc
yaml
```

Possibly nothing else beyond Bun.

Do not add dependencies for:

- UUIDs;
- hashing;
- SQLite;
- HTTP;
- browser opening;
- argument parsing;

if Bun or the standard library already provide adequate functionality.

---

# 93. Performance

Performance is not a major challenge here.

Optimize for:

- fast CLI startup;
- small generated HTML;
- low memory use;
- instant local interaction.

Do not build caching infrastructure.

A normal report containing hundreds of paragraphs should feel immediate.

---

# 94. Final manual verification

Before finishing implementation:

1. install dependencies;
2. run type checking;
3. run tests;
4. validate the example report;
5. create the example report with the server stopped;
6. inspect the generated standalone HTML;
7. open it through `file://`;
8. select text;
9. create at least three comments;
10. edit one;
11. delete one;
12. reload and verify best-effort localStorage restoration if the browser supports it;
13. press `Copy All Comments`;
14. inspect the generated Markdown;
15. use `Download Comments.md`;
16. run `folio list`;
17. run `folio show`;
18. run `folio open`;
19. run `folio serve`;
20. verify the archive page;
21. confirm the primary workflow never required the server.

---

# 95. Final response

When implementation is complete, respond with a concise engineering summary containing:

- what was implemented;
- important architecture choices;
- how to install it;
- how to run the zero-server workflow;
- how `Copy All Comments` works;
- where reports are stored;
- how to install/use the agent skill;
- test results;
- any remaining MVP limitations.

Do not paste the whole source code into the final response.

Do not end with an implementation plan.

The repository should be in a working state.

---

# 96. Final product test

The project is successful if this feels natural:

```text
Agent:
“I finished the investigation. I created a Folio report.”

Browser opens.

User:
reads
selects sentence
adds comment
selects another sentence
adds comment
selects code
adds comment

User clicks:
Copy All Comments

Clipboard now contains:

# Review feedback: ...

## Comment 1
> ...

...

User pastes it into Codex.

Codex understands exactly which parts of its report need changes.
```

That loop is the product.

Everything else is supporting infrastructure.

When in doubt, optimize that loop.