import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function minimalReport(body = "## Details\n\nEverything is documented.", frontmatter = ""): string {
  return `---
schema: folio/v1
title: Minimal report
kind: general
tags: []
${frontmatter}---

{% summary %}
Concise summary.
{% /summary %}

${body}
`;
}

export async function temporaryDirectory(prefix = "folio-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTemporaryDirectory(path: string): Promise<void> {
  if (!path.startsWith(tmpdir())) throw new Error(`Refusing to remove non-temporary path: ${path}`);
  await rm(path, { recursive: true, force: true });
}

export function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

export async function runCli(
  home: string,
  args: string[],
  stdin?: string,
  environment: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, ...environment, FOLIO_HOME: home },
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
