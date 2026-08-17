# Folio

Folio turns substantial coding-agent output into durable, readable HTML reports you can review like code. It is local-first and server-free: one CLI command stores source and metadata, generates one standalone HTML file, and opens it in your browser.

Select report text, add anchored comments in the right review rail, then copy structured Markdown back into your coding agent. No daemon, browser extension, cloud account, or network connection participates in that loop.

## Install

Folio is distributed as source through npm and requires [Bun](https://bun.sh/) 1.3 or newer. Run it without installing:

```bash
bunx agent-folio --help
```

`npx` uses the same npm package and works when `bun` is already on PATH:

```bash
npx agent-folio --help
```

Install the command globally if preferred:

```bash
bun add --global agent-folio
folio --help
```

Remove it with `bun remove --global agent-folio`. The npm package executes the TypeScript source directly with Bun; it does not download or build a platform bundle. Node-only execution is not currently supported because Folio uses Bun's SQLite and HTTP runtime APIs.

Standalone executables remain available as an optional installation. Download the archive for your OS and CPU from the GitHub release, verify it against `SHA256SUMS`, extract it, and place the executable on PATH. macOS and Linux users can install an extracted binary with:

```bash
install -m 755 folio-darwin-arm64 ~/.local/bin/folio
```

Use the matching filename for your platform. Release assets cover macOS, Linux, and Windows on arm64 and x64, and include `SHA256SUMS`.

The macOS downloads are not notarized. If Gatekeeper quarantines one, review the downloaded file and approve it in **System Settings → Privacy & Security** before running it.

To compile and install a standalone binary from a checkout:

```bash
bun install
bun run install:binary
```

This builds a standalone executable at `~/.local/bin/folio`. It does not edit shell profiles. Use `--bin-dir <directory>` for another location or `--force` to replace an existing binary:

```bash
bun run scripts/install.ts --bin-dir ~/.local/bin --force
```

## Quick start

```bash
folio create examples/auth-investigation.mdoc
```

Report opens as standalone `file://` HTML.

Select text → **Comment** → write feedback → **Copy All Comments**.

Use `--no-open` for automation:

```bash
bun run src/cli.ts create examples/auth-investigation.mdoc --no-open --json
```

## Folio Markdoc

Reports use strict `Folio Markdoc v1`: YAML frontmatter, one leading summary, ordinary Markdown, and a small semantic tag set.

```markdoc
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
```

Generate a skeleton or concise syntax guide:

```bash
folio template investigation
folio format
```

Raw HTML, arbitrary tags, unsafe links, H1 headings, nested semantic blocks, and normal Markdown images are rejected.

## File links and media artifacts

Reference source files with paths relative to Git root. Folio turns them into local links and preserves evidence locations in exported feedback:

```markdoc
The race starts in {% file path="src/auth/session.ts" lines="84-117" /%}.
```

Attach image or video artifacts from testing with the dedicated `media` tag:

```markdoc
{% media path="artifacts/fixed-page.png" alt="Fixed page in Chrome" caption="Acceptance result" /%}

{% media path="artifacts/interaction.mp4" kind="video" caption="Interaction recording" /%}
```

Media bytes are embedded as data URLs. Copying only `report.html` keeps images, videos, styling, annotation UI, and export logic intact. Media and file paths must be Git-root-relative; symlinked media may not escape the repository.

## Browser review

Each paragraph, heading, list item, blockquote, and code block has a deterministic annotation anchor. Selections stay inside one block and may not overlap existing comments.

Comments appear in a right-side review rail and support add, edit, delete, clear, and best-effort `localStorage` persistence. If storage is unavailable, current-tab review still works. **Copy All Comments** writes document-ordered Markdown containing report context, quoted text, section, optional evidence path, and feedback. Clipboard failure opens a manual-copy dialog. **Download Comments.md** exports identical Markdown.

The table of contents navigates report headings. Theme selection supports system, light, and dark modes. HTML, PDF, and Markdown share controls keep repository-relative file labels while omitting absolute local links from exported documents.

Comments never enter SQLite and are not synchronized. A new report revision gets a new report ID and separate browser review state.

## CLI

```text
folio create <file|-> [--stdin] [--no-open] [--json] [--supersedes <id>]
folio validate <file|-> [--json]
folio template <kind>
folio format
folio list [--repo <key>] [--kind <kind>] [--limit <n>] [--json]
folio show <id> [--source] [--json]
folio open <id|latest>
folio path
folio serve [--host 127.0.0.1] [--port 7331]
folio skill install [--target <skills-directory>] [--data-dir <directory>] [--force] [--json]
folio completion <bash|zsh|fish>
folio --version
```

Pass `--data-dir <directory>` to any command that reads or writes the catalog. It has precedence over `FOLIO_HOME`; relative paths resolve from the current directory.

`create` validates before writing, collects local Git metadata, writes report artifacts atomically, and inserts catalog metadata. It opens HTML by default only in an interactive terminal; `--json`, `--no-open`, CI, and redirected output skip implicit opening. Browser-opening failure does not discard or fail report creation.

Unknown options fail. Use `--` before a path beginning with `-`. Set `FOLIO_DEBUG=1` to include a stack trace for unexpected failures. Generate basic shell completion with, for example, `folio completion zsh`.

## Storage

Folio resolves its data directory in this order:

1. `FOLIO_HOME`
2. `$XDG_DATA_HOME/folio`
3. `~/.local/share/folio`

```text
folio.sqlite
reports/<report-id>/
  report.mdoc
  report.html
  meta.json
```

SQLite uses foreign keys and WAL mode. Reports are immutable. `meta.json` duplicates important catalog metadata so artifact directories remain understandable without SQLite. Folio never writes generated reports into your Git repository.

## Optional archive

The review workflow does not require a server. `folio serve` adds a read-only archive and repository source viewer:

```bash
folio serve
# http://127.0.0.1:7331
```

Served reports use the current review shell, so older immutable artifacts gain current navigation and controls without being rewritten on disk. A **Back to all reports** action returns to the archive. Referenced repository files open in a Night Owl syntax-highlighted viewer with JetBrains Mono, line-aware comments, and the shared theme switcher. Source access is limited to files referenced by the report, contained inside the repository root, and served only on loopback. A non-loopback host requires explicit `--allow-network`; served metadata omits the absolute repository root and repository links are disabled.

## Coding-agent skill

Repo includes compact skill at [`skills/folio-report`](skills/folio-report/SKILL.md). Install it into Codex skill discovery:

```bash
folio skill install
```

Without a global install:

```bash
bunx agent-folio skill install
```

The command installs into `$CODEX_HOME/skills/folio-report`, or `~/.codex/skills/folio-report` when `CODEX_HOME` is unset. Use `--target <skills-directory>` for another agent skill directory. Existing modified content is preserved unless you explicitly pass `--force`.

For coding-agent sandboxes that cannot write to the normal user-data directory, configure a writable report root while installing the skill:

```bash
folio skill install --data-dir .folio --force
```

The installer records this value in the skill's small runtime reference. The skill then passes `--data-dir .folio` whenever it invokes Folio. Relative paths are repository-local; add `.folio/` to that repository's ignore rules if you use this layout. An absolute writable path can instead provide one shared catalog.

Then invoke `$folio-report`, or let it trigger for substantial work products. Skill uses progressive disclosure: short workflow in `SKILL.md`, full format details in `references/format.md`, and CLI-generated templates for common report kinds.

## Development

```bash
bun run typecheck
bun test
bun run check
bun run test:package
bun run build:binary
```

Tests isolate `FOLIO_HOME`; they never touch your real catalog.

`bun run build:release` cross-compiles the six optional release executables into `dist/`. GitHub Actions checks Linux, macOS, and Windows, smoke-tests the packed npm command, bundles executables with license notices, generates SHA-256 checksums, publishes the npm package with provenance, and creates a GitHub release when a matching version tag is pushed:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The tag must equal `v` plus the version in `package.json`. Before the first release, configure `srsatt/folio` as a trusted publisher for `agent-folio` on npm. A manual workflow run builds the same downloadable archives as workflow artifacts without creating a GitHub release or publishing npm.

## Security model

Report input is untrusted text. Folio allowlists tags and attributes, rejects raw HTML and unsafe URLs, HTML-escapes report content, and writes comment content only through DOM text APIs. Generated HTML contains no remote scripts, stylesheets, fonts, analytics, telemetry, API calls, uploads, or background processes. Media is read locally once and embedded. Repository links require an explicit click.

## MVP limits

- Text selections cannot cross blocks or overlap.
- Review state is browser-local and differs between `file://` and archive HTTP origins.
- Media embedding increases HTML size, especially for video.
- Repository links target local absolute `file://` paths generated at creation time, so they may not work after moving HTML to another machine.
- No collaboration, comment threads, syncing, report editing, full-text search, generated PDF/DOCX files, AI calls, MCP, or GitHub/GitLab API integration. Browser print-to-PDF remains available.

See [Folio.md](Folio.md) for complete product specification.
