#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface ReleaseOptions {
  version: string | null;
  dryRun: boolean;
  skipGates: boolean;
  watch: boolean;
  help: boolean;
}

interface WorkflowRun {
  databaseId: number;
  headBranch: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  url: string;
}

export class ReleaseError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReleaseError";
  }
}

const projectRoot = resolve(import.meta.dir, "..");
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(code: string, message: string): never {
  throw new ReleaseError(code, message);
}

export function parseReleaseArgs(args: string[]): ReleaseOptions {
  const options: ReleaseOptions = {
    version: null,
    dryRun: false,
    skipGates: false,
    watch: true,
    help: false,
  };
  for (const argument of args) {
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--skip-gates") options.skipGates = true;
    else if (argument === "--no-watch") options.watch = false;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("-")) fail("E_RELEASE_USAGE", `Unknown option: ${argument}`);
    else if (options.version) fail("E_RELEASE_USAGE", `Unexpected argument: ${argument}`);
    else options.version = argument;
  }
  if (!options.help && !options.version) fail("E_RELEASE_USAGE", "Missing version. Use `bun run release -- <version>`.");
  if (options.version && !stableVersion.test(options.version)) {
    fail("E_RELEASE_VERSION", `Invalid semantic version: ${options.version}`);
  }
  return options;
}

export function validateReleaseMetadata(version: string, packageVersion: string, changelog: string): void {
  if (packageVersion !== version) {
    fail("E_RELEASE_VERSION", `package.json is ${packageVersion}; requested release is ${version}. Update package.json first.`);
  }
  if (!changelog.includes(`## [${version}]`)) {
    fail("E_RELEASE_CHANGELOG", `CHANGELOG.md has no section for ${version}. Add release notes first.`);
  }
}

function normalizeGitHubRemote(remote: string): string {
  return remote.trim()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git$/, "");
}

async function command(
  executable: string,
  args: string[],
  options: { capture?: boolean; allowFailure?: boolean } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const capture = options.capture === true;
  const child = Bun.spawn([executable, ...args], {
    cwd: projectRoot,
    stdin: "ignore",
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
    env: process.env,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    capture ? new Response(child.stdout).text() : Promise.resolve(""),
    capture ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);
  if (exitCode !== 0 && !options.allowFailure) {
    fail("E_RELEASE_COMMAND", `${executable} ${args.join(" ")} failed (${exitCode}).${stderr ? `\n${stderr.trim()}` : ""}`);
  }
  return { exitCode, stdout, stderr };
}

async function output(executable: string, args: string[]): Promise<string> {
  return (await command(executable, args, { capture: true })).stdout.trim();
}

async function requireCleanMain(version: string): Promise<{ head: string; tag: string }> {
  const repositoryRoot = resolve(await output("git", ["rev-parse", "--show-toplevel"]));
  if (repositoryRoot !== projectRoot) fail("E_RELEASE_REPOSITORY", `Run from the Folio checkout: ${projectRoot}`);
  if (await output("git", ["branch", "--show-current"]) !== "main") {
    fail("E_RELEASE_STATE", "Releases must run from the main branch.");
  }

  const authorName = await output("git", ["config", "--get", "user.name"]);
  const authorEmail = await output("git", ["config", "--get", "user.email"]);
  if (authorName !== "srsatt" || authorEmail !== "srsatt@gmail.com") {
    fail("E_RELEASE_IDENTITY", `Git author must be srsatt <srsatt@gmail.com>; found ${authorName} <${authorEmail}>.`);
  }
  const login = await output("gh", ["api", "user", "--jq", ".login"]);
  if (login !== "srsatt") fail("E_RELEASE_IDENTITY", `Active GitHub account must be srsatt; found ${login || "none"}.`);
  const remote = normalizeGitHubRemote(await output("git", ["remote", "get-url", "origin"]));
  if (remote !== "https://github.com/srsatt/folio") {
    fail("E_RELEASE_REPOSITORY", `origin must be https://github.com/srsatt/folio; found ${remote}.`);
  }

  const status = await output("git", ["status", "--porcelain"]);
  if (status) fail("E_RELEASE_STATE", "Working tree is not clean. Commit or discard changes before releasing.");
  console.error("Fetching origin/main and tags…");
  await command("git", ["fetch", "--quiet", "origin", "main", "--tags"]);
  const head = await output("git", ["rev-parse", "HEAD"]);
  const originMain = await output("git", ["rev-parse", "refs/remotes/origin/main"]);
  if (head !== originMain) {
    fail("E_RELEASE_STATE", `Local main (${head.slice(0, 12)}) must equal origin/main (${originMain.slice(0, 12)}). Pull or push first.`);
  }

  const tag = `v${version}`;
  const existingTag = await command("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], {
    capture: true,
    allowFailure: true,
  });
  if (existingTag.exitCode === 0) fail("E_RELEASE_TAG_EXISTS", `Remote tag ${tag} already exists.`);
  if (existingTag.exitCode !== 2) {
    fail("E_RELEASE_COMMAND", `Could not check remote tag ${tag}: ${existingTag.stderr.trim() || `exit ${existingTag.exitCode}`}`);
  }
  return { head, tag };
}

async function runGates(): Promise<void> {
  const gates: Array<[string, string[]]> = [
    ["bun", ["run", "check"]],
    ["bun", ["run", "test:e2e"]],
    ["bun", ["run", "test:package"]],
    ["bun", ["run", "build:release"]],
  ];
  for (const [executable, args] of gates) {
    console.error(`Running ${executable} ${args.join(" ")}…`);
    await command(executable, args);
  }
  if (await output("git", ["status", "--porcelain"])) {
    fail("E_RELEASE_STATE", "Release gates changed tracked files. Review and commit them before releasing.");
  }
}

async function waitForWorkflow(tag: string, head: string): Promise<WorkflowRun> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const raw = await output("gh", [
      "run", "list",
      "--workflow", "release.yml",
      "--event", "push",
      "--limit", "10",
      "--json", "databaseId,headBranch,headSha,status,conclusion,url",
    ]);
    const runs = JSON.parse(raw) as WorkflowRun[];
    const run = runs.find((candidate) => candidate.headBranch === tag && candidate.headSha === head);
    if (run) return run;
    await Bun.sleep(2_000);
  }
  fail("E_RELEASE_WORKFLOW", `Release workflow did not start for ${tag}. Check https://github.com/srsatt/folio/actions.`);
}

function printHelp(): void {
  console.log(`Usage: bun run release -- <version> [options]

Create and push a version tag from a clean, synchronized main branch. GitHub Actions
builds binaries, creates the GitHub release, and publishes the npm package.

Options:
  --dry-run       Validate state and run gates without creating a tag
  --skip-gates    Skip local release gates; CI still runs them
  --no-watch      Push the tag without waiting for GitHub Actions
  -h, --help      Show this help

Examples:
  bun run release -- 0.3.0 --dry-run
  bun run release -- 0.3.0`);
}

async function main(args: string[]): Promise<void> {
  const options = parseReleaseArgs(args);
  if (options.help) {
    printHelp();
    return;
  }
  const version = options.version!;
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8")) as { version?: string };
  const changelog = await readFile(resolve(projectRoot, "CHANGELOG.md"), "utf8");
  validateReleaseMetadata(version, String(packageJson.version ?? ""), changelog);
  const { head, tag } = await requireCleanMain(version);
  if (!options.skipGates) await runGates();

  if (options.dryRun) {
    console.log(`Release dry run passed: ${tag} at ${head}`);
    return;
  }

  console.error(`Creating annotated tag ${tag}…`);
  await command("git", ["tag", "-a", tag, "-m", `Folio ${tag}`]);
  console.error(`Pushing ${tag} to origin…`);
  await command("git", ["push", "origin", tag]);
  if (!options.watch) {
    console.log(`Tag pushed: https://github.com/srsatt/folio/actions`);
    return;
  }

  console.error("Waiting for release workflow…");
  const run = await waitForWorkflow(tag, head);
  await command("gh", ["run", "watch", String(run.databaseId), "--exit-status"]);
  const releaseUrl = await output("gh", ["release", "view", tag, "--json", "url", "--jq", ".url"]);
  console.log(`Released ${tag}: ${releaseUrl}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof ReleaseError ? error.code : "E_RELEASE_UNEXPECTED";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`folio release ${code}: ${message}`);
    process.exitCode = 1;
  });
}
