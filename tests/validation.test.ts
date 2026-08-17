import { describe, expect, test } from "bun:test";

import { reportTemplate } from "../src/report/templates";
import { FolioValidationError, validateReport } from "../src/report/validate";
import { REPORT_KINDS } from "../src/types";
import { minimalReport } from "./helpers";

function codes(source: string): string[] {
  try {
    validateReport(source, "case.mdoc");
    return [];
  } catch (error) {
    if (!(error instanceof FolioValidationError)) throw error;
    return error.diagnostics.map((item) => item.code);
  }
}

describe("Folio Markdoc validation", () => {
  test("accepts minimal and complex reports", async () => {
    expect(validateReport(minimalReport()).summary).toBe("Concise summary.");
    const example = await Bun.file(new URL("../examples/auth-investigation.mdoc", import.meta.url)).text();
    expect(validateReport(example).frontmatter.kind).toBe("investigation");
  });

  test("normalizes line endings and duplicate tags", () => {
    const source = minimalReport().replace("tags: []", "tags: [Auth, auth]").replace(/\n/g, "\r\n");
    const parsed = validateReport(source);
    expect(parsed.source.includes("\r")).toBe(false);
    expect(parsed.frontmatter.tags).toEqual(["Auth"]);
  });

  const cases: Array<[string, string, string]> = [
    ["missing frontmatter", "No frontmatter", "frontmatter.missing"],
    ["wrong schema", minimalReport().replace("folio/v1", "folio/v2"), "frontmatter.schema"],
    ["missing title", minimalReport().replace("title: Minimal report\n", ""), "frontmatter.title"],
    ["invalid kind", minimalReport().replace("kind: general", "kind: mystery"), "frontmatter.kind"],
    ["unknown frontmatter", minimalReport(undefined, "mystery: true\n"), "frontmatter.unknown"],
    ["missing summary", minimalReport().replace(/\{% summary %\}[\s\S]*?\{% \/summary %\}\n\n/, ""), "summary.missing"],
    ["two summaries", minimalReport().replace("## Details", "{% summary %}Again{% /summary %}\n\n## Details"), "summary.multiple"],
    ["summary after heading", minimalReport().replace("{% summary %}", "## Early\n\n{% summary %}"), "summary.position"],
    ["H1", minimalReport("# Wrong"), "heading.h1"],
    ["H5", minimalReport("##### Too deep"), "heading.depth"],
    ["unknown tag", minimalReport("{% mystery /%}"), "tag.unknown"],
    ["unknown attribute", minimalReport("{% finding title=\"X\" mystery=\"Y\" %}Body{% /finding %}"), "tag.attribute-unknown"],
    ["required attribute", minimalReport("{% finding %}Body{% /finding %}"), "tag.attribute-required"],
    ["invalid enum", minimalReport("{% finding title=\"X\" severity=\"urgent\" %}Body{% /finding %}"), "tag.attribute-enum"],
    ["invalid semantic ID", minimalReport("{% risk id=\"Not valid\" title=\"X\" %}Body{% /risk %}"), "tag.attribute-id"],
    ["duplicate semantic ID", minimalReport("{% risk id=\"same\" title=\"A\" %}A{% /risk %}\n\n{% decision id=\"same\" title=\"B\" %}B{% /decision %}"), "tag.id-duplicate"],
    ["nested blocks", minimalReport("{% finding title=\"X\" %}\n\n{% risk title=\"Y\" %}Body{% /risk %}\n\n{% /finding %}"), "tag.nested"],
    ["raw HTML", minimalReport("<script>alert(1)</script>"), "html.raw"],
    ["Markdown image", minimalReport("![artifact](result.png)"), "markdown.image"],
    ["unsafe link", minimalReport("[click](javascript:alert(1))"), "link.unsafe"],
    ["relative link", minimalReport("[source](src/file.ts)"), "link.unsafe"],
    ["unsafe file path", minimalReport("See {% file path=\"../secret\" /%}."), "tag.attribute-path"],
    ["invalid line range", minimalReport("See {% file path=\"src/a.ts\" lines=\"ten\" /%}."), "tag.attribute-lines"],
    ["image missing alt", minimalReport("{% media path=\"artifacts/a.png\" /%}"), "media.alt"],
  ];

  test.each(cases)("rejects %s", (_name, source, expectedCode) => {
    expect(codes(source)).toContain(expectedCode);
  });

  test("accepts repository-relative file and media tags", () => {
    const parsed = validateReport(minimalReport(`See {% file path="src/a.ts" lines="2-4" /%}.

{% media path="artifacts/run.mp4" kind="video" caption="Test run" /%}`));
    expect(parsed.frontmatter.title).toBe("Minimal report");
  });

  test("every generated template is valid", () => {
    for (const kind of REPORT_KINDS) expect(validateReport(reportTemplate(kind)).frontmatter.kind).toBe(kind);
  });

  test("diagnostics include source lines", () => {
    try {
      validateReport(minimalReport("# Wrong"), "bad.mdoc");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(FolioValidationError);
      expect((error as FolioValidationError).diagnostics.find((item) => item.code === "heading.h1")?.line).toBeGreaterThan(1);
    }
  });
});
