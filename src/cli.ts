#!/usr/bin/env bun

import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };

import { resolveFolioHome } from "./config";
import { getLatestReport, getReport, listReports, openDatabase } from "./db";
import { collectGitMetadata } from "./git";
import { startArchiveServer } from "./server";
import { storeReport } from "./storage";
import { installBundledSkill, resolveCodexSkillsDirectory } from "./skill";
import type { ReportRecord } from "./types";
import { FORMAT_GUIDE, isReportKind, reportTemplate } from "./report/templates";
import { FolioValidationError, formatDiagnostics, validateReport } from "./report/validate";

const HELP = `Usage: folio <command> [options]

Commands:
  create <file|-> [--stdin] [--no-open] [--json] [--supersedes <id>]
  validate <file|-> [--json]
  template <kind>
  format
  list [--repo <key>] [--kind <kind>] [--limit <n>] [--json]
  show <id> [--source] [--json]
  open <id|latest>
  serve [--host 127.0.0.1] [--port 7331] [--allow-network]
  skill install [--target <skills-directory>] [--data-dir <directory>] [--force] [--json]
  completion <bash|zsh|fish>
  path
  -V, --version

Data location:
  --data-dir <directory>  Override FOLIO_HOME; relative paths resolve from current directory
`;

const COMMAND_HELP: Record<string, string> = {
  create: "Usage: folio create <file|-> [--stdin] [--no-open] [--json] [--supersedes <id>] [--data-dir <directory>]",
  validate: "Usage: folio validate <file|-> [--stdin] [--json]",
  template: "Usage: folio template <architecture|benchmark|incident|implementation|investigation|plan|review|general>",
  format: "Usage: folio format",
  list: "Usage: folio list [--repo <key>] [--kind <kind>] [--limit <n>] [--json] [--data-dir <directory>]",
  show: "Usage: folio show <id> [--source] [--json] [--data-dir <directory>]",
  open: "Usage: folio open <id|latest> [--data-dir <directory>]",
  serve: "Usage: folio serve [--host 127.0.0.1] [--port 7331] [--allow-network] [--data-dir <directory>]",
  path: "Usage: folio path [--data-dir <directory>]",
  completion: "Usage: folio completion <bash|zsh|fish>",
  skill: "Usage: folio skill install [--target <skills-directory>] [--data-dir <directory>] [--force] [--json]",
};

const VALUE_FLAGS = new Set(["--supersedes", "--repo", "--kind", "--limit", "--host", "--port", "--target", "--data-dir"]);

const COMMAND_FLAGS: Record<string, ReadonlySet<string>> = {
  create: new Set(["--stdin", "--no-open", "--json", "--supersedes", "--data-dir"]),
  validate: new Set(["--stdin", "--json"]),
  template: new Set(),
  format: new Set(),
  list: new Set(["--repo", "--kind", "--limit", "--json", "--data-dir"]),
  show: new Set(["--source", "--json", "--data-dir"]),
  open: new Set(["--data-dir"]),
  serve: new Set(["--host", "--port", "--allow-network", "--data-dir"]),
  path: new Set(["--data-dir"]),
};

const POSITIONAL_LIMITS: Record<string, readonly [minimum: number, maximum: number]> = {
  create: [0, 1],
  validate: [0, 1],
  template: [1, 1],
  format: [0, 0],
  list: [0, 0],
  show: [1, 1],
  open: [1, 1],
  serve: [0, 0],
  path: [0, 0],
  completion: [1, 1],
};

function packageVersion(): string {
  return packageJson.version;
}

function valueAfter(args: string[], flag: string): string | null {
  const terminator = args.indexOf("--");
  const index = args.findIndex((argument, candidate) => argument === flag && (terminator === -1 || candidate < terminator));
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function hasFlag(args: string[], flag: string): boolean {
  const terminator = args.indexOf("--");
  return args.some((argument, index) => argument === flag && (terminator === -1 || index < terminator));
}

function positional(args: string[]): string[] {
  const result: string[] = [];
  let optionsEnded = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (optionsEnded) {
      result.push(arg);
      continue;
    }
    if (arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      index++;
      continue;
    }
    if (!arg.startsWith("--") || arg === "-") result.push(arg);
  }
  return result;
}

function assertOptions(command: string, args: string[]): void {
  const supported = COMMAND_FLAGS[command];
  if (!supported) return;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") break;
    if (!argument?.startsWith("-") || argument === "-") continue;
    if (!supported.has(argument)) throw new Error(`Unknown option for ${command}: ${argument}`);
    if (VALUE_FLAGS.has(argument)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    }
  }
}

function assertPositionals(command: string, args: string[]): void {
  const limits = POSITIONAL_LIMITS[command];
  if (!limits) return;
  const count = positional(args).length;
  if (count < limits[0] || count > limits[1]) throw new Error(COMMAND_HELP[command] ?? `Invalid arguments for ${command}`);
}

function completion(shell: string): string {
  const commands = "create validate template format list show open serve skill path completion";
  if (shell === "bash") return `complete -W "${commands}" folio`;
  if (shell === "zsh") return `#compdef folio\n_arguments '1:command:(${commands})'`;
  if (shell === "fish") return commands.split(" ").map((command) => `complete -c folio -f -n '__fish_use_subcommand' -a '${command}'`).join("\n");
  throw new Error(`Unknown shell: ${shell}. Expected bash, zsh, or fish.`);
}

function shouldOpenImplicitly(args: string[]): boolean {
  return !hasFlag(args, "--no-open") && !hasFlag(args, "--json") && !process.env.CI && Boolean(process.stdout.isTTY);
}

async function readSource(argument: string | null, stdinFlag: boolean): Promise<{ source: string; file: string }> {
  if (stdinFlag || argument === "-") return { source: await Bun.stdin.text(), file: "<stdin>" };
  if (!argument) throw new Error("Missing report path. Pass a file, `-`, or `--stdin`.");
  const path = resolve(process.cwd(), argument);
  const file = Bun.file(path);
  if (!await file.exists()) throw new Error(`Report source not found: ${path}`);
  return { source: await file.text(), file: path };
}

export async function openInBrowser(path: string): Promise<boolean> {
  const command = process.platform === "darwin"
    ? ["open", path]
    : process.platform === "win32"
      ? ["rundll32.exe", "url.dll,FileProtocolHandler", path]
      : ["xdg-open", path];
  try {
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    return await child.exited === 0;
  } catch {
    return false;
  }
}

function reportJson(report: ReportRecord): Record<string, unknown> {
  return {
    id: report.id,
    title: report.title,
    kind: report.kind,
    summary: report.summary,
    tags: report.tags,
    createdAt: report.createdAt,
    contentHash: report.contentHash,
    sourcePath: report.sourcePath,
    htmlPath: report.htmlPath,
    repository: {
      key: report.repoKey,
      root: report.repoRoot,
      remote: report.repoRemote,
      branch: report.repoBranch,
      commit: report.repoCommit,
      dirty: report.repoDirty,
    },
    supersedes: report.supersedesId,
  };
}

function printShow(report: ReportRecord): void {
  console.log(`${report.title}

Kind: ${report.kind}
Created: ${report.createdAt}
Repository: ${report.repoKey ?? "-"}
Branch: ${report.repoBranch ?? "-"}
Commit: ${report.repoCommit ?? "-"}
Source: ${report.sourcePath}
HTML: ${report.htmlPath}`);
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  const command = args[0];
  const rest = args.slice(1);
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }
  if (command === "help") {
    console.log(rest[0] ? COMMAND_HELP[rest[0]] ?? `Unknown command: ${rest[0]}\n\n${HELP}` : HELP);
    return rest[0] && !COMMAND_HELP[rest[0]] ? 1 : 0;
  }
  if (command === "--version" || command === "-V" || command === "version") {
    console.log(packageVersion());
    return 0;
  }

  try {
    if (hasFlag(rest, "--help") || hasFlag(rest, "-h")) {
      const help = COMMAND_HELP[command];
      if (!help) throw new Error(`Unknown command: ${command}`);
      console.log(help);
      return 0;
    }
    if (command === "skill") {
      if (rest[0] !== "install") throw new Error("Usage: folio skill install [--target <skills-directory>] [--data-dir <directory>] [--force] [--json]");
      const skillArgs = rest.slice(1);
      const supportedFlags = new Set(["--target", "--data-dir", "--force", "--json"]);
      for (let index = 0; index < skillArgs.length; index++) {
        const argument = skillArgs[index];
        if (!argument || !argument.startsWith("--") || !supportedFlags.has(argument)) {
          throw new Error(`Unknown skill install option: ${argument ?? "(missing)"}`);
        }
        if (argument === "--target" || argument === "--data-dir") index++;
      }
      const target = valueAfter(skillArgs, "--target");
      const dataDirectory = valueAfter(skillArgs, "--data-dir");
      const result = await installBundledSkill({
        skillsDirectory: target ? resolve(process.cwd(), target) : resolveCodexSkillsDirectory(),
        dataDirectory,
        force: skillArgs.includes("--force"),
      });
      if (skillArgs.includes("--json")) console.log(JSON.stringify(result));
      else if (result.action === "unchanged") console.log(`Folio skill already installed:\n${result.path}`);
      else console.log(`${result.action === "replaced" ? "Updated" : "Installed"} Folio skill:\n${result.path}`);
      return 0;
    }

    if (command === "completion") {
      assertOptions(command, rest);
      assertPositionals(command, rest);
      const shell = positional(rest)[0];
      if (!shell) throw new Error("Missing shell. Expected bash, zsh, or fish.");
      console.log(completion(shell));
      return 0;
    }

    assertOptions(command, rest);
    assertPositionals(command, rest);

    const home = resolveFolioHome(process.env, valueAfter(rest, "--data-dir"));
    if (command === "path") {
      console.log(home);
      return 0;
    }
    if (command === "format") {
      console.log(FORMAT_GUIDE);
      return 0;
    }
    if (command === "template") {
      const kind = positional(rest)[0];
      if (!kind || !isReportKind(kind)) throw new Error(`Unknown report kind: ${kind ?? "(missing)"}`);
      console.log(reportTemplate(kind));
      return 0;
    }
    if (command === "validate") {
      const json = hasFlag(rest, "--json");
      const input = await readSource(positional(rest)[0] ?? null, hasFlag(rest, "--stdin"));
      try {
        const parsed = validateReport(input.source, input.file);
        if (json) console.log(JSON.stringify({ valid: true, title: parsed.frontmatter.title, kind: parsed.frontmatter.kind, summary: parsed.summary }));
        else console.log(`Valid Folio report\n\n${parsed.frontmatter.title}\n${parsed.frontmatter.kind}`);
        return 0;
      } catch (error) {
        if (error instanceof FolioValidationError && json) {
          console.log(JSON.stringify({ valid: false, errors: error.diagnostics }));
          return 1;
        }
        throw error;
      }
    }
    if (command === "create") {
      const json = hasFlag(rest, "--json");
      const input = await readSource(positional(rest)[0] ?? null, hasFlag(rest, "--stdin"));
      const parsed = validateReport(input.source, input.file);
      const db = openDatabase(home);
      try {
        const supersedes = valueAfter(rest, "--supersedes");
        if (supersedes && !getReport(db, supersedes)) throw new Error(`Superseded report not found: ${supersedes}`);
        const created = await storeReport(db, home, parsed, collectGitMetadata(), supersedes);
        const opened = shouldOpenImplicitly(rest) ? await openInBrowser(created.record.htmlPath) : false;
        if (json) {
          console.log(JSON.stringify({
            id: created.record.id,
            title: created.record.title,
            htmlPath: created.record.htmlPath,
            contentHash: created.record.contentHash,
            opened,
          }));
        } else {
          const git = created.record.repoKey && created.record.repoCommit
            ? `\nGit:\n${created.record.repoKey} @ ${created.record.repoCommit.slice(0, 7)}${created.record.repoDirty ? " (dirty)" : ""}\n`
            : "";
          console.log(`Created Folio report

${created.record.title}
${created.record.id}

HTML:
${created.record.htmlPath}
${git}
${shouldOpenImplicitly(rest) ? opened ? "Opened in browser." : "Could not open browser; report was created successfully." : "Browser opening skipped."}`);
        }
        return 0;
      } finally {
        db.close();
      }
    }

    if (["list", "show", "open", "serve"].includes(command)) {
      const db = openDatabase(home);
      if (command === "list") {
        try {
          const limitText = valueAfter(rest, "--limit");
          const limit = limitText === null ? 20 : Number(limitText);
          if (!Number.isInteger(limit) || limit < 1) throw new Error("`--limit` must be a positive integer.");
          const reports = listReports(db, {
            repo: valueAfter(rest, "--repo") ?? undefined,
            kind: valueAfter(rest, "--kind") ?? undefined,
            limit,
          });
          if (hasFlag(rest, "--json")) console.log(JSON.stringify(reports.map(reportJson)));
          else if (reports.length === 0) console.log("No Folio reports.");
          else console.log(reports.map((report) => `${report.createdAt}  ${report.kind}\n${report.id}  ${report.title}`).join("\n\n"));
          return 0;
        } finally {
          db.close();
        }
      }
      if (command === "show") {
        try {
          const id = positional(rest)[0];
          if (!id) throw new Error("Missing report ID.");
          const report = getReport(db, id);
          if (!report) throw new Error(`Report not found: ${id}`);
          if (hasFlag(rest, "--source")) console.log(report.sourceText);
          else if (hasFlag(rest, "--json")) console.log(JSON.stringify(reportJson(report)));
          else printShow(report);
          return 0;
        } finally {
          db.close();
        }
      }
      if (command === "open") {
        try {
          const id = positional(rest)[0];
          if (!id) throw new Error("Missing report ID or `latest`.");
          const report = id === "latest" ? getLatestReport(db) : getReport(db, id);
          if (!report) throw new Error(`Report not found: ${id}`);
          if (!await openInBrowser(report.htmlPath)) throw new Error(`Could not open browser. HTML: ${report.htmlPath}`);
          console.log(`Opened ${report.title}\n${report.htmlPath}`);
          return 0;
        } finally {
          db.close();
        }
      }
      const host = valueAfter(rest, "--host") ?? "127.0.0.1";
      const portText = valueAfter(rest, "--port") ?? "7331";
      const port = Number(portText);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("`--port` must be an integer from 0 to 65535.");
      if (!["127.0.0.1", "localhost", "::1"].includes(host) && !hasFlag(rest, "--allow-network")) {
        db.close();
        throw new Error("Non-loopback binding requires `--allow-network`.");
      }
      const server = startArchiveServer(db, { hostname: host, port });
      console.log(`Folio archive: http://${server.hostname}:${server.port}`);
      await new Promise((done) => {
        const stop = () => {
          server.stop(true);
          db.close();
          done(undefined);
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      return 0;
    }
    throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (hasFlag(rest, "--json")) {
      console.error(JSON.stringify({ ok: false, error: { code: error instanceof FolioValidationError ? "VALIDATION_ERROR" : "CLI_ERROR", message, ...(error instanceof FolioValidationError ? { diagnostics: error.diagnostics } : {}) } }));
    } else if (error instanceof FolioValidationError) console.error(`folio: report validation failed\n\n${formatDiagnostics(error)}`);
    else {
      console.error(`folio: ${message}`);
      if (COMMAND_HELP[command]) console.error(`Run 'folio ${command} --help' for usage.`);
      if (process.env.FOLIO_DEBUG === "1" && error instanceof Error && error.stack) console.error(`\n${error.stack}`);
    }
    return 1;
  }
}

async function flushStream(stream: NodeJS.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write("", (error) => error ? reject(error) : resolve());
  });
}

export async function runCliMain(): Promise<void> {
  process.exitCode = await runCli();
  await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
}

if (import.meta.main) await runCliMain();
