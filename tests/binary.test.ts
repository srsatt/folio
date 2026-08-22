import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { minimalReport, removeTemporaryDirectory, temporaryDirectory } from "./helpers";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(removeTemporaryDirectory));
});

async function run(command: string[], environment: Record<string, string> = {}, stdin?: string) {
  const child = Bun.spawnSync(command, {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, ...environment },
    ...(stdin === undefined ? {} : { stdin: Buffer.from(stdin) }),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  };
}

describe("standalone binary", () => {
  const platformTest = process.platform === "win32" ? test.skip : test;

  platformTest("installer builds a self-contained CLI with report and skill assets", async () => {
    const root = await temporaryDirectory("folio-binary-");
    temporary.push(root);
    const packageJson = await Bun.file(join(import.meta.dir, "..", "package.json")).json() as { version: string };
    const binDirectory = join(root, "bin");
    const binary = join(binDirectory, process.platform === "win32" ? "folio.exe" : "folio");
    const folioHome = join(root, "data");
    const codexHome = join(root, "codex");

    const installed = await run(["bun", "run", "build:install", "--", "--bin-dir", binDirectory]);
    expect(installed.exitCode).toBe(0);
    expect(await Bun.file(binary).exists()).toBe(true);
    const version = await run([binary, "--version"]);
    expect({ ...version, stdout: version.stdout.trim(), stderr: version.stderr.trim() }).toEqual({
      exitCode: 0,
      stdout: packageJson.version,
      stderr: "",
    });

    const created = await run(
      [binary, "create", "--stdin", "--no-open", "--json", "--data-dir", folioHome],
      {},
      minimalReport(),
    );
    expect(created.exitCode).toBe(0);
    const report = JSON.parse(created.stdout);
    const html = await Bun.file(report.htmlPath).text();
    expect(html).toContain("<style>");
    expect(html).toContain("folio-comment-action");

    const skill = await run([binary, "skill", "install", "--data-dir", ".folio", "--json"], { CODEX_HOME: codexHome });
    expect(skill.exitCode).toBe(0);
    expect(JSON.parse(skill.stdout).action).toBe("installed");
    expect(await Bun.file(join(codexHome, "skills", "folio-report", "SKILL.md")).exists()).toBe(true);
    expect(await Bun.file(join(codexHome, "skills", "folio-report", "references", "runtime.md")).text()).toContain('data_directory: ".folio"');

    const protectedResult = await run(["bun", "run", "scripts/install.ts", "--bin-dir", binDirectory]);
    expect(protectedResult.exitCode).toBe(1);
    expect(protectedResult.stderr).toContain("Run again with --force");
  }, 30_000);
});
