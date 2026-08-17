import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "../..");
let workspace: string;
let server: ChildProcess;
let origin: string;

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "folio-e2e-"));
  const sourcePath = join(workspace, "report.mdoc");
  await writeFile(sourcePath, `---
schema: folio/v1
title: Browser acceptance report
kind: review
tags: [browser]
---

{% summary %}
The review shell works end to end.
{% /summary %}

## Navigation target

Review {% file path="src/cli.ts" lines="1-3" /%} before release.
`);
  const environment = { ...process.env, FOLIO_HOME: join(workspace, "data") };
  const created = spawnSync("bun", ["run", "src/cli.ts", "create", sourcePath, "--no-open", "--json"], {
    cwd: projectRoot,
    env: environment,
    encoding: "utf8",
  });
  if (created.status !== 0) throw new Error(created.stderr || created.stdout);

  server = spawn("bun", ["run", "src/cli.ts", "serve", "--port", "0"], {
    cwd: projectRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  origin = await new Promise<string>((resolveOrigin, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for Folio server.")), 10_000);
    server.stdout?.on("data", (chunk) => {
      const match = String(chunk).match(/Folio archive: (http:\/\/[^\s]+)/);
      if (!match?.[1]) return;
      clearTimeout(timer);
      resolveOrigin(match[1]);
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Folio server exited before startup (${code}).`));
    });
  });
});

test.afterAll(async () => {
  if (server && !server.killed) server.kill("SIGTERM");
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test("reviews and shares a served report", async ({ page }) => {
  await page.goto(origin);
  await page.getByRole("link", { name: "Browser acceptance report" }).click();

  await expect(page.getByRole("link", { name: "Back to all reports" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Table of contents" }).getByRole("link", { name: "Navigation target" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download HTML" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download Markdown" })).toBeVisible();

  await page.getByLabel("Theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-folio-theme", "dark");

  const paragraph = page.locator(".folio-document p").last();
  await paragraph.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByLabel("Feedback").fill("Ship this flow.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("complementary", { name: "Review comments" })).toContainText("Ship this flow.");

  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML" }).click();
  const downloaded = await htmlDownload;
  const downloadPath = await downloaded.path();
  if (!downloadPath) throw new Error("Browser did not expose the downloaded HTML path.");
  const sharedHtml = await readFile(downloadPath, "utf8");
  expect(sharedHtml).not.toContain(projectRoot);
  expect(sharedHtml).toContain("src/cli.ts");
  expect(sharedHtml).not.toContain("Back to all reports");

  await page.getByRole("link", { name: "Back to all reports" }).click();
  await expect(page.getByRole("heading", { name: "Folio reports" })).toBeVisible();
});

test("opens a highlighted repository source page", async ({ page }) => {
  await page.goto(origin);
  await page.getByRole("link", { name: "Browser acceptance report" }).click();
  await page.getByRole("link", { name: "src/cli.ts:1-3" }).click();
  await expect(page.locator(".shiki")).toBeVisible();
  await expect(page.locator("#L1")).toBeVisible();
  await expect(page.locator(".folio-source-code")).toHaveCSS("font-family", /JetBrains Mono/);
  await expect(page.getByRole("complementary", { name: "Review comments" })).toBeVisible();
});
