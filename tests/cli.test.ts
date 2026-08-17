import { afterEach, describe, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

import { minimalReport, removeTemporaryDirectory, runCli, temporaryDirectory } from "./helpers";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(removeTemporaryDirectory));
});

describe("CLI", () => {
  test("validates files and stdin with JSON diagnostics", async () => {
    const home = await temporaryDirectory("folio-cli-");
    temporary.push(home);
    const valid = await runCli(home, ["validate", "--stdin", "--json"], minimalReport());
    expect(valid.exitCode).toBe(0);
    expect(JSON.parse(valid.stdout).valid).toBe(true);

    const invalid = await runCli(home, ["validate", "-", "--json"], "invalid");
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stdout).valid).toBe(false);
  });

  test("creates, lists, shows, and reads source without opening browser", async () => {
    const home = await temporaryDirectory("folio-cli-");
    temporary.push(home);
    const created = await runCli(home, ["create", "--stdin", "--no-open", "--json"], minimalReport());
    expect(created.exitCode).toBe(0);
    const output = JSON.parse(created.stdout);
    expect(output.opened).toBe(false);
    expect(await Bun.file(output.htmlPath).exists()).toBe(true);

    const listed = await runCli(home, ["list", "--limit", "5", "--json"]);
    expect(JSON.parse(listed.stdout)).toHaveLength(1);
    const shown = await runCli(home, ["show", output.id, "--json"]);
    expect(JSON.parse(shown.stdout).id).toBe(output.id);
    const source = await runCli(home, ["show", output.id, "--source"]);
    expect(source.stdout).toContain("schema: folio/v1");
  });

  test("prints templates, format guide, and resolved path", async () => {
    const home = await temporaryDirectory("folio-cli-");
    const override = await temporaryDirectory("folio-data-override-");
    temporary.push(home, override);
    const template = await runCli(home, ["template", "architecture"]);
    expect(template.stdout).toContain("kind: architecture");
    expect(template.stdout).toContain("{% summary %}");
    const format = await runCli(home, ["format"]);
    expect(format.stdout).toContain("Folio Markdoc v1");
    expect(format.stdout).toContain("media path=");
    const path = await runCli(home, ["path"]);
    expect(path.stdout.trim()).toBe(home);
    const overriddenPath = await runCli(home, ["path", "--data-dir", override]);
    expect(overriddenPath.stdout.trim()).toBe(override);
    const version = await runCli(home, ["--version"]);
    expect(version.stdout.trim()).toBe(packageJson.version);

    const help = await runCli(home, ["create", "--help"]);
    expect(help.stdout).toContain("Usage: folio create");
    const completion = await runCli(home, ["completion", "zsh"]);
    expect(completion.stdout).toContain("#compdef folio");
  });

  test("rejects unknown options and emits structured JSON errors", async () => {
    const home = await temporaryDirectory("folio-cli-");
    temporary.push(home);
    const unknown = await runCli(home, ["list", "--wat"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("Unknown option for list: --wat");
    expect(unknown.stderr).toContain("folio list --help");

    const terminated = await runCli(home, ["validate", "--", "--json"]);
    expect(terminated.exitCode).toBe(1);
    expect(terminated.stderr).toContain("Report source not found");
    expect(terminated.stderr).toContain("folio validate --help");

    const json = await runCli(home, ["show", "missing", "--json"]);
    expect(json.exitCode).toBe(1);
    expect(JSON.parse(json.stderr)).toEqual({
      ok: false,
      error: { code: "CLI_ERROR", message: "Report not found: missing" },
    });
  });

  test("installs, preserves, and explicitly replaces the bundled skill", async () => {
    const home = await temporaryDirectory("folio-cli-");
    const codexHome = await temporaryDirectory("folio-codex-");
    temporary.push(home, codexHome);
    const environment = { CODEX_HOME: codexHome };

    const installed = await runCli(home, ["skill", "install", "--data-dir", ".folio", "--json"], undefined, environment);
    expect(installed.exitCode).toBe(0);
    const installedResult = JSON.parse(installed.stdout);
    expect(installedResult.action).toBe("installed");
    expect(installedResult.dataDirectory).toBe(".folio");
    expect(installedResult.path).toBe(join(codexHome, "skills", "folio-report"));
    expect(await Bun.file(join(installedResult.path, "SKILL.md")).text()).toContain("name: folio-report");
    expect(await Bun.file(join(installedResult.path, "references", "runtime.md")).text()).toContain('data_directory: ".folio"');

    const unchanged = await runCli(home, ["skill", "install", "--data-dir", ".folio", "--json"], undefined, environment);
    expect(JSON.parse(unchanged.stdout).action).toBe("unchanged");

    await Bun.write(join(installedResult.path, "SKILL.md"), "locally changed\n");
    const protectedResult = await runCli(home, ["skill", "install", "--data-dir", ".folio"], undefined, environment);
    expect(protectedResult.exitCode).toBe(1);
    expect(protectedResult.stderr).toContain("Run again with --force");

    const replaced = await runCli(home, ["skill", "install", "--data-dir", ".folio", "--force", "--json"], undefined, environment);
    expect(JSON.parse(replaced.stdout).action).toBe("replaced");
    expect(await Bun.file(join(installedResult.path, "SKILL.md")).text()).toContain("name: folio-report");
  });

  test("does not create artifacts for invalid input", async () => {
    const home = await temporaryDirectory("folio-cli-");
    temporary.push(home);
    const result = await runCli(home, ["create", "--stdin", "--no-open"], "invalid");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("report validation failed");
    expect(await Bun.file(join(home, "folio.sqlite")).exists()).toBe(false);
  });

  test("skips implicit opening when non-interactive and supports explicit open", async () => {
    if (process.platform === "win32") return;
    const home = await temporaryDirectory("folio-cli-");
    const bin = await temporaryDirectory("folio-opener-");
    temporary.push(home, bin);
    const command = process.platform === "darwin" ? "open" : "xdg-open";
    const opener = join(bin, command);
    await Bun.write(opener, "#!/bin/sh\nexit 0\n");
    await chmod(opener, 0o755);
    const environment = { PATH: `${bin}:${process.env.PATH ?? ""}` };

    const created = await runCli(home, ["create", "--stdin", "--json"], minimalReport(), environment);
    expect(created.exitCode).toBe(0);
    expect(JSON.parse(created.stdout).opened).toBe(false);
    expect((await runCli(home, ["open", "latest"], undefined, environment)).exitCode).toBe(0);

    await Bun.write(opener, "#!/bin/sh\nexit 1\n");
    await chmod(opener, 0o755);
    const failedOpen = await runCli(home, ["open", "latest"], undefined, environment);
    expect(failedOpen.exitCode).toBe(1);
    expect(failedOpen.stderr).toContain("Could not open browser");
  });
});
