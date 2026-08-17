#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface ReleaseTarget {
  bunTarget: Bun.Build.CompileTarget;
  filename: string;
}

export const RELEASE_TARGETS: ReleaseTarget[] = [
  { bunTarget: "bun-darwin-arm64", filename: "folio-darwin-arm64" },
  { bunTarget: "bun-darwin-x64", filename: "folio-darwin-x64" },
  { bunTarget: "bun-linux-arm64", filename: "folio-linux-arm64" },
  { bunTarget: "bun-linux-x64-baseline", filename: "folio-linux-x64" },
  { bunTarget: "bun-windows-arm64", filename: "folio-windows-arm64.exe" },
  { bunTarget: "bun-windows-x64-baseline", filename: "folio-windows-x64.exe" },
];

const projectRoot = resolve(import.meta.dir, "..");
const entrypoint = join(projectRoot, "src/cli.ts");

export async function buildBinary(options: {
  outfile: string;
  target?: Bun.Build.CompileTarget;
}): Promise<void> {
  const outfile = resolve(options.outfile);
  await mkdir(dirname(outfile), { recursive: true });
  const compile = options.target
    ? { target: options.target, outfile, autoloadDotenv: false, autoloadBunfig: false }
    : { outfile, autoloadDotenv: false, autoloadBunfig: false };
  const result = await Bun.build({
    entrypoints: [entrypoint],
    compile,
    minify: true,
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join("\n") || "Bun failed to compile Folio.");
  }
}

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function main(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: bun run scripts/build.ts [--all] [--target <bun-target>] [--outfile <path>]");
    return;
  }
  const known = new Set(["--all", "--target", "--outfile"]);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument || !known.has(argument)) throw new Error(`Unknown option: ${argument ?? "(missing)"}`);
    if (argument === "--target" || argument === "--outfile") index++;
  }
  if (args.includes("--all")) {
    if (args.includes("--target") || args.includes("--outfile")) throw new Error("--all cannot be combined with --target or --outfile.");
    for (const target of RELEASE_TARGETS) {
      const outfile = join(projectRoot, "dist", target.filename);
      console.log(`Building ${target.bunTarget} -> ${outfile}`);
      await buildBinary({ outfile, target: target.bunTarget });
    }
    return;
  }

  const requestedTarget = valueAfter(args, "--target") as Bun.Build.CompileTarget | null;
  const defaultName = process.platform === "win32" ? "folio.exe" : "folio";
  const outfile = valueAfter(args, "--outfile") ?? join(projectRoot, "dist", defaultName);
  await buildBinary({ outfile, ...(requestedTarget ? { target: requestedTarget } : {}) });
  console.log(`Built Folio binary:\n${resolve(outfile)}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`folio build: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
