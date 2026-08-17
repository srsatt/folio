#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = resolve(import.meta.dir, "..");

async function run(command: string[], options: { cwd: string; env?: Record<string, string> }): Promise<string> {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed (${exitCode})\n${stderr || stdout}`);
  return stdout;
}

const workspace = await mkdtemp(join(tmpdir(), "folio-package-smoke-"));
try {
  const npmEnvironment = {
    npm_config_cache: join(workspace, "npm-cache"),
    npm_config_dry_run: "false",
    npm_config_update_notifier: "false",
  };
  const packed = JSON.parse(await run(
    ["npm", "pack", "--json", "--pack-destination", workspace],
    { cwd: projectRoot, env: npmEnvironment },
  )) as Array<{ filename: string }>;
  const archive = packed[0]?.filename;
  if (!archive) throw new Error("npm pack did not produce an archive.");

  await run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", join(workspace, archive)], {
    cwd: workspace,
    env: npmEnvironment,
  });
  const executable = process.platform === "win32"
    ? join(workspace, "node_modules", ".bin", "folio.cmd")
    : join(workspace, "node_modules", ".bin", "folio");
  const version = (await run([executable, "--version"], {
    cwd: workspace,
    env: { FOLIO_HOME: join(workspace, "data") },
  })).trim();
  if (version !== packageJson.version) throw new Error(`Packed CLI returned unexpected version: ${version}`);
  const npxVersion = (await run(["npx", "--no-install", "folio", "--version"], {
    cwd: workspace,
    env: { ...npmEnvironment, FOLIO_HOME: join(workspace, "data") },
  })).trim();
  if (npxVersion !== packageJson.version) throw new Error(`npx returned unexpected version: ${npxVersion}`);
  console.log(`Packed npm/npx CLI smoke test passed (${archive}, Folio ${version}).`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
