import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Drives the real CLI entry point (node dist/cli.js) as a separate process.
// dist/ must be built first, which `pnpm --filter @school-connector-kit/capture test` does automatically.

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(packageDir, "dist", "cli.js");

const ALLOWLIST = {
  version: "e2e-1",
  rules: [{ path: "id", mode: "keep" as const }],
};

const INPUT = {
  id: "E2E_ID_001",
  pupil: { name: "PUPIL_E2E_CANARY_QW1" },
  note: "E2E_NOTE_CANARY_QW2",
};

function spawn(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd: packageDir,
  });
}

describe("capture CLI process (e2e)", () => {
  it("writes a capture with exit code 0 and no canaries in output", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-e2e-"));
    try {
      const input = join(dir, "in.json");
      const allowlist = join(dir, "allowlist.json");
      const output = join(dir, "out.json");
      writeFileSync(input, JSON.stringify(INPUT), "utf8");
      writeFileSync(allowlist, JSON.stringify(ALLOWLIST), "utf8");

      const run = spawn([
        "--input",
        input,
        "--allowlist",
        allowlist,
        "--platform",
        "example",
        "--captured-at",
        "2025-06-15T08:30:00Z",
        "--method",
        "GET",
        "--url-template",
        "/api/e2e?from={cursor}",
        "--status",
        "200",
        "--output",
        output,
      ]);

      expect(run.status).toBe(0);
      expect(run.stdout).toContain("capture written");
      const content = readFileSync(output, "utf8");
      expect(content).not.toContain("PUPIL_E2E_CANARY_QW1");
      expect(content).not.toContain("E2E_NOTE_CANARY_QW2");
      expect(JSON.parse(content).capture_format).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 on an invalid status without echoing input contents", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-e2e-"));
    try {
      const input = join(dir, "in.json");
      const allowlist = join(dir, "allowlist.json");
      writeFileSync(input, JSON.stringify(INPUT), "utf8");
      writeFileSync(allowlist, JSON.stringify(ALLOWLIST), "utf8");

      const run = spawn([
        "--input",
        input,
        "--allowlist",
        allowlist,
        "--platform",
        "example",
        "--captured-at",
        "2025-06-15T08:30:00Z",
        "--method",
        "GET",
        "--url-template",
        "/api/e2e",
        "--status",
        "999",
        "--output",
        join(dir, "out.json"),
      ]);

      expect(run.status).toBe(1);
      expect(run.stderr.length).toBeGreaterThan(0);
      expect(run.stderr).not.toContain("PUPIL_E2E_CANARY_QW1");
      expect(run.stderr).not.toContain("E2E_ID_001");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed on reserved object keys, without leaking the value", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-e2e-"));
    try {
      const input = join(dir, "in.json");
      const allowlist = join(dir, "allowlist.json");
      writeFileSync(
        input,
        JSON.stringify({
          data: { "pupil.name": "RESERVED_E2E_CANARY_XY3" },
        }),
        "utf8",
      );
      writeFileSync(
        allowlist,
        JSON.stringify({
          version: "e2e-1",
          rules: [{ path: "data.pupil.name", mode: "keep" }],
        }),
        "utf8",
      );

      const run = spawn([
        "--input",
        input,
        "--allowlist",
        allowlist,
        "--platform",
        "example",
        "--captured-at",
        "2025-06-15T08:30:00Z",
        "--method",
        "GET",
        "--url-template",
        "/api/e2e",
        "--status",
        "200",
        "--output",
        join(dir, "out.json"),
      ]);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain("reserved path syntax");
      expect(run.stderr).not.toContain("RESERVED_E2E_CANARY_XY3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown flags", () => {
    const run = spawn(["--definitely-not-a-flag", "1"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("unknown option");
  });
});
