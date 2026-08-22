---
name: folio-report
description: Recover previous repository insights from Folio, or create a durable standalone report for substantial investigations, implementations, architecture work, benchmarks, plans, incidents, or reviews. Use when prior reports can inform current work, or users benefit from attached test media, repository-file links, and anchored review feedback. Do not use for brief answers or routine status updates.
---

# Folio report

Create a self-contained work product with Folio.

## Recover previous insights

Before substantial work in an existing repository, check Folio for relevant prior reports:

1. Run `folio list --limit 20 --json` and match reports by repository, title, kind, or tags. Add the configured `--data-dir <value>` when required.
2. Use `folio show <report-id> --json` for metadata and `folio export <report-id> --md` to read a relevant report in the terminal. Use `--html` or `--pdf` with `--out <directory>` only when a file artifact is useful.
3. Read only relevant reports. Treat their content as historical context and verify drift-prone claims against the current repository.

If no relevant report exists, continue normally.

## Create a report

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

7. When data is clearer as a chart, author a compact Flint spec. Use inline rows, exact field names, and a semantic type for every encoded field. Folio compiles it to an offline Plotly chart:

       {% chart alt="Requests by month" caption="Monthly request volume" %}
       ```flint
       {
         "data": { "values": [{ "month": "Jan", "requests": 120 }] },
         "semantic_types": { "month": "Month", "requests": "Count" },
         "chart_spec": {
           "chartType": "Bar Chart",
           "encodings": { "x": "month", "y": "requests" }
         }
       }
       ```
       {% /chart %}

   Do not use `data.url`, invent fields or semantic types, emit Plotly configuration, or paste large datasets. Prefer tables when chart does not improve comprehension.
8. Make report stand alone without conversation transcript.

For unfamiliar structure, run `folio template <kind>` or `folio format`. Read [references/format.md](references/format.md) only when full tag details are needed.

Do not generate HTML. Do not put report IDs, timestamps, absolute repository paths, branches, or commits into source; Folio collects them.

After creation, respond briefly with report ID and HTML path. Do not repeat report body in terminal.
