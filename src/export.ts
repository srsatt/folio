import { constants } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ReportRecord } from "./types";

export type ExportFormat = "md" | "html" | "pdf";

const BROWSER_COMMANDS = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
] as const;

function browserPaths(environment: Record<string, string | undefined>): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  if (process.platform === "win32") {
    return [environment.PROGRAMFILES, environment["PROGRAMFILES(X86)"], environment.LOCALAPPDATA]
      .filter((root): root is string => Boolean(root))
      .flatMap((root) => [
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
        join(root, "Chromium", "Application", "chrome.exe"),
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      ]);
  }
  return [];
}

async function executableExists(path: string): Promise<boolean> {
  return access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK).then(() => true, () => false);
}

async function pdfIsComplete(path: string): Promise<boolean> {
  const file = Bun.file(path);
  if (!await file.exists() || file.size < 6) return false;
  const tail = await file.slice(Math.max(0, file.size - 1_024), file.size).text();
  return tail.includes("%%EOF");
}

export async function resolvePdfBrowser(environment = process.env): Promise<string | null> {
  const configured = environment.FOLIO_CHROME_BIN?.trim();
  if (configured) {
    const path = resolve(configured);
    if (!await executableExists(path)) {
      throw new Error(`FOLIO_CHROME_BIN is not executable: ${path}`);
    }
    return path;
  }
  for (const command of BROWSER_COMMANDS) {
    const path = Bun.which(command);
    if (path) return path;
  }
  for (const path of browserPaths(environment)) {
    if (await executableExists(path)) return path;
  }
  return null;
}

async function renderPdf(htmlPath: string, outputPath: string, environment: Record<string, string | undefined>): Promise<void> {
  const browser = await resolvePdfBrowser(environment);
  if (!browser) {
    throw new Error("PDF export requires Chrome, Chromium, or Edge. Install one or set FOLIO_CHROME_BIN to its executable.");
  }
  const profile = await mkdtemp(join(tmpdir(), "folio-pdf-"));
  try {
    const child = Bun.spawn([
      browser,
      "--headless",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${outputPath}`,
      pathToFileURL(htmlPath).href,
    ], { stdout: "ignore", stderr: "ignore" });
    let exitCode: number | null = null;
    void child.exited.then((code) => {
      exitCode = code;
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && exitCode === null && !await pdfIsComplete(outputPath)) {
      await Bun.sleep(100);
    }
    if (await pdfIsComplete(outputPath)) {
      if (exitCode === null) {
        child.kill();
        await Promise.race([child.exited, Bun.sleep(1_000)]);
      }
      return;
    }
    if (exitCode === null) {
      child.kill();
      await rm(outputPath, { force: true });
      throw new Error(`PDF export timed out after 30 seconds with ${browser}.`);
    }
    await rm(outputPath, { force: true });
    throw new Error(`PDF export failed with ${browser} (exit ${exitCode}). Set FOLIO_DEBUG=1 and run the browser directly for details.`);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

export async function exportReportFile(
  report: ReportRecord,
  format: ExportFormat,
  outputDirectory: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string> {
  const directory = resolve(outputDirectory);
  const outputPath = join(directory, `${report.id}.${format}`);
  await mkdir(directory, { recursive: true });
  if (format === "md") await Bun.write(outputPath, report.sourceText);
  else if (format === "html") await copyFile(report.htmlPath, outputPath);
  else {
    await rm(outputPath, { force: true });
    await renderPdf(report.htmlPath, outputPath, environment);
  }
  return outputPath;
}
