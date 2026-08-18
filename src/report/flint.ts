import type { Node } from "@markdoc/markdoc";
import { SemanticTypes, type ChartAssemblyInput } from "flint-chart/core";
import { assemblePlotly } from "flint-chart/plotly";

const MAX_SPEC_BYTES = 512 * 1024;
const MAX_ROWS = 5_000;
const MAX_FIELDS = 100;

export interface CompiledFlintChart {
  data: unknown[];
  layout: Record<string, unknown>;
  warnings: string[];
}

export class FlintChartError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FlintChartError";
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function encodedFields(encodings: Record<string, unknown>): string[] {
  const fields: string[] = [];
  for (const encoding of Object.values(encodings)) {
    const values = Array.isArray(encoding) ? encoding : [encoding];
    for (const value of values) {
      if (typeof value === "string") fields.push(value);
      else {
        const field = objectValue(value)?.field;
        if (typeof field === "string") fields.push(field);
      }
    }
  }
  return [...new Set(fields)];
}

function warningText(value: unknown): string {
  if (typeof value === "string") return value;
  const warning = objectValue(value);
  if (typeof warning?.message === "string") return warning.message;
  return JSON.stringify(value);
}

export function flintSourceFromNode(node: Node): string {
  if (node.children.length !== 1 || node.children[0]?.type !== "fence") {
    throw new FlintChartError("chart.structure", "`chart` must contain exactly one fenced `flint` code block.");
  }
  const fence = node.children[0];
  if (fence.attributes.language !== "flint") {
    throw new FlintChartError("chart.language", "The chart code fence language must be `flint`.");
  }
  return String(fence.attributes.content ?? "");
}

export function compileFlintChart(source: string): CompiledFlintChart {
  if (new TextEncoder().encode(source).byteLength > MAX_SPEC_BYTES) {
    throw new FlintChartError("chart.size", `Flint chart spec must not exceed ${MAX_SPEC_BYTES / 1024} KiB.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new FlintChartError("chart.json", `Invalid Flint JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const input = objectValue(parsed);
  if (!input) throw new FlintChartError("chart.input", "Flint chart spec must be a JSON object.");
  const data = objectValue(input.data);
  if (!data || !Array.isArray(data.values)) {
    throw new FlintChartError("chart.data", "Flint charts in Folio require inline `data.values`; file and remote URL data are not allowed.");
  }
  if (data.values.length === 0) throw new FlintChartError("chart.data-empty", "Flint chart `data.values` must contain at least one row.");
  if (data.values.length > MAX_ROWS) throw new FlintChartError("chart.rows", `Flint charts may contain at most ${MAX_ROWS} rows.`);
  if (data.values.some((row) => !objectValue(row))) throw new FlintChartError("chart.row", "Every Flint chart data row must be a JSON object.");

  const rows = data.values as Array<Record<string, unknown>>;
  const fields = new Set(rows.flatMap((row) => Object.keys(row)));
  if (fields.size > MAX_FIELDS) throw new FlintChartError("chart.fields", `Flint charts may contain at most ${MAX_FIELDS} data fields.`);

  const chartSpec = objectValue(input.chart_spec);
  if (!chartSpec || typeof chartSpec.chartType !== "string" || !chartSpec.chartType.trim()) {
    throw new FlintChartError("chart.type", "Flint `chart_spec.chartType` must be a non-empty string.");
  }
  const encodings = objectValue(chartSpec.encodings);
  if (!encodings || Object.keys(encodings).length === 0) {
    throw new FlintChartError("chart.encodings", "Flint `chart_spec.encodings` must be a non-empty object.");
  }

  const semanticTypes = objectValue(input.semantic_types);
  for (const field of encodedFields(encodings)) {
    if (!fields.has(field)) throw new FlintChartError("chart.field-missing", `Flint encoding references missing data field: ${field}.`);
    const annotation = semanticTypes?.[field];
    if (annotation === undefined) {
      throw new FlintChartError("chart.semantic-type", `Flint encoded field needs a semantic type: ${field}.`);
    }
    const semanticType = typeof annotation === "string" ? annotation : objectValue(annotation)?.semanticType;
    if (typeof semanticType !== "string" || !Object.hasOwn(SemanticTypes, semanticType)) {
      throw new FlintChartError("chart.semantic-type-unknown", `Unknown Flint semantic type for ${field}: ${String(semanticType)}.`);
    }
  }

  let figure: unknown;
  try {
    figure = assemblePlotly(input as unknown as ChartAssemblyInput);
  } catch (error) {
    throw new FlintChartError("chart.compile", `Flint Plotly compilation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = objectValue(figure);
  const layout = objectValue(result?.layout);
  if (!result || !Array.isArray(result.data) || !layout) {
    throw new FlintChartError("chart.output", "Flint Plotly compiler returned an invalid figure.");
  }
  const warnings = Array.isArray(result._warnings) ? result._warnings.map(warningText) : [];
  return { data: result.data, layout, warnings };
}

export function compileFlintNode(node: Node): CompiledFlintChart {
  return compileFlintChart(flintSourceFromNode(node));
}
