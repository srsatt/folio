#!/usr/bin/env bun

import { chmod, copyFile, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { buildBinary } from "./build";

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false);
}

async function main(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: bun run scripts/install.ts [--bin-dir <directory>] [--force]");
    return;
  }
  const known = new Set(["--bin-dir", "--force"]);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument || !known.has(argument)) throw new Error(`Unknown option: ${argument ?? "(missing)"}`);
    if (argument === "--bin-dir") index++;
  }

  const configuredDirectory = valueAfter(args, "--bin-dir") ?? process.env.FOLIO_BIN_DIR?.trim();
  const binDirectory = resolve(configuredDirectory || join(homedir(), ".local", "bin"));
  const name = process.platform === "win32" ? "folio.exe" : "folio";
  const destination = join(binDirectory, name);
  const destinationExists = await exists(destination);
  if (destinationExists && !args.includes("--force")) {
    throw new Error(`Binary already exists: ${destination}\nRun again with --force to replace it.`);
  }

  await mkdir(binDirectory, { recursive: true });
  const buildDirectory = await mkdtemp(join(tmpdir(), "folio-install-"));
  const built = join(buildDirectory, name);
  const nonce = randomUUID();
  const staged = join(binDirectory, `.${name}.tmp-${nonce}`);
  const backup = join(binDirectory, `.${name}.backup-${nonce}`);
  let movedExisting = false;
  try {
    await buildBinary({ outfile: built });
    await copyFile(built, staged);
    await chmod(staged, 0o755);
    if (destinationExists) {
      await rename(destination, backup);
      movedExisting = true;
    }
    try {
      await rename(staged, destination);
    } catch (error) {
      if (movedExisting) await rename(backup, destination);
      throw error;
    }
    if (movedExisting) await rm(backup, { force: true });
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
    await rm(staged, { force: true });
  }

  console.log(`Installed Folio binary:\n${destination}`);
  const pathEntries = (process.env.PATH ?? "").split(delimiter).map((entry) => resolve(entry));
  if (!pathEntries.includes(binDirectory)) {
    console.log(`\n${binDirectory} is not currently on PATH. Add it to PATH to run \`folio\` by name.`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`folio install: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
