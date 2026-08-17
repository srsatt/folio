import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import skillMarkdown from "../skills/folio-report/SKILL.md" with { type: "text" };
import openaiYaml from "../skills/folio-report/agents/openai.yaml" with { type: "text" };
import formatMarkdown from "../skills/folio-report/references/format.md" with { type: "text" };
import defaultRuntimeMarkdown from "../skills/folio-report/references/runtime.md" with { type: "text" };

const SKILL_NAME = "folio-report";

function runtimeMarkdown(dataDirectory: string | null): string {
  if (!dataDirectory) return defaultRuntimeMarkdown;
  return `# Runtime configuration

data_directory: ${JSON.stringify(dataDirectory)}

Pass \`--data-dir\` with this exact value to every Folio command that reads or writes report data. Resolve relative values from the relevant Git repository root.
`;
}

function skillFiles(dataDirectory: string | null): Map<string, string> {
  return new Map([
    ["SKILL.md", skillMarkdown],
    ["agents/openai.yaml", openaiYaml],
    ["references/format.md", formatMarkdown],
    ["references/runtime.md", runtimeMarkdown(dataDirectory)],
  ]);
}

export interface SkillInstallResult {
  action: "installed" | "replaced" | "unchanged";
  path: string;
  dataDirectory: string | null;
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false);
}

async function matchesBundledSkill(destination: string, files: Map<string, string>): Promise<boolean> {
  for (const [relativePath, content] of files) {
    const installed = await readFile(join(destination, relativePath), "utf8").catch(() => null);
    if (installed !== content) return false;
  }
  return true;
}

export function resolveCodexSkillsDirectory(environment = process.env): string {
  const codexHome = environment.CODEX_HOME?.trim();
  return resolve(codexHome || join(homedir(), ".codex"), "skills");
}

export async function installBundledSkill(options: {
  skillsDirectory: string;
  dataDirectory?: string | null;
  force?: boolean;
}): Promise<SkillInstallResult> {
  const skillsDirectory = resolve(options.skillsDirectory);
  const dataDirectory = options.dataDirectory?.trim() || null;
  const files = skillFiles(dataDirectory);
  const destination = join(skillsDirectory, SKILL_NAME);
  await mkdir(skillsDirectory, { recursive: true });

  const destinationExists = await exists(destination);
  if (destinationExists && await matchesBundledSkill(destination, files)) {
    return { action: "unchanged", path: destination, dataDirectory };
  }
  if (destinationExists && !options.force) {
    throw new Error(`Skill already exists and differs: ${destination}\nRun again with --force to replace it.`);
  }

  const nonce = randomUUID();
  const temporary = join(skillsDirectory, `.${SKILL_NAME}.tmp-${nonce}`);
  const backup = join(skillsDirectory, `.${SKILL_NAME}.backup-${nonce}`);
  let movedExisting = false;
  try {
    for (const [relativePath, content] of files) {
      const output = join(temporary, relativePath);
      await mkdir(dirname(output), { recursive: true });
      await Bun.write(output, content);
    }
    if (destinationExists) {
      await rename(destination, backup);
      movedExisting = true;
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (movedExisting) await rename(backup, destination);
      throw error;
    }
    if (movedExisting) await rm(backup, { recursive: true, force: true });
    return { action: destinationExists ? "replaced" : "installed", path: destination, dataDirectory };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
