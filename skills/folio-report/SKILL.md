---
name: folio-report
description: Create a durable, standalone HTML report for substantial investigations, implementations, architecture work, benchmarks, plans, incidents, or reviews. Use when users benefit from reading, inspecting attached test media, following repository-file links, and leaving anchored feedback in a review rail outside terminal output. Do not use for brief answers or routine status updates.
---

# Folio report

Create a self-contained work product with Folio.

1. Read [references/runtime.md](references/runtime.md). If `data_directory` is not null, pass `--data-dir <value>` to every Folio command. Resolve relative values from the relevant Git repository root.
2. Run from relevant Git repository root so file and media paths resolve correctly.
3. Write valid Folio Markdoc, then pipe it to:

       folio create --stdin --json

   When configured, append the runtime option:

       folio create --stdin --json --data-dir <value>

4. Use normal Markdown for prose. Add semantic blocks only when they improve scanning.
5. Reference relevant repository files with `{% file path="src/example.ts" lines="10-24" /%}`. Paths must be Git-root-relative.
6. Attach useful testing artifacts with a self-closing `media` tag. Images and videos are embedded into standalone HTML:

       {% media path="artifacts/result.png" alt="Result page after fix" caption="Browser verification" /%}

7. Make report stand alone without conversation transcript.

For unfamiliar structure, run `folio template <kind>` or `folio format`. Read [references/format.md](references/format.md) only when full tag details are needed.

Do not generate HTML. Do not put report IDs, timestamps, absolute repository paths, branches, or commits into source; Folio collects them.

After creation, respond briefly with report ID and HTML path. Do not repeat report body in terminal.
