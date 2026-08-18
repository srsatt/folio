import { describe, expect, test } from "bun:test";

import { parseReleaseArgs, ReleaseError, validateReleaseMetadata } from "../scripts/release";

describe("release automation", () => {
  test("parses a release and safety flags", () => {
    expect(parseReleaseArgs(["0.3.0", "--dry-run", "--skip-gates", "--no-watch"])).toEqual({
      version: "0.3.0",
      dryRun: true,
      skipGates: true,
      watch: false,
      help: false,
    });
  });

  test("supports help without a version", () => {
    expect(parseReleaseArgs(["--help"]).help).toBe(true);
  });

  test("rejects missing, malformed, and extra arguments", () => {
    for (const args of [[], ["next"], ["0.3.0", "extra"], ["0.3.0", "--force"]]) {
      expect(() => parseReleaseArgs(args)).toThrow(ReleaseError);
    }
  });

  test("requires package and changelog versions to match", () => {
    expect(() => validateReleaseMetadata("0.3.0", "0.3.0", "## [0.3.0] - 2026-08-18")).not.toThrow();
    expect(() => validateReleaseMetadata("0.3.0", "0.2.0", "## [0.3.0]")).toThrow(ReleaseError);
    expect(() => validateReleaseMetadata("0.3.0", "0.3.0", "## [Unreleased]")).toThrow(ReleaseError);
  });
});
