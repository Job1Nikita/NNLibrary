import { execFile } from "child_process";
import { promisify } from "util";
import { env } from "../config/env";

const execFileAsync = promisify(execFile);

export type AvScanResult = {
  status: "clean" | "infected" | "unavailable";
  details: string;
};

function commandNotFound(error: unknown): boolean {
  const nodeError = error as NodeJS.ErrnoException | undefined;
  return nodeError?.code === "ENOENT";
}

function parseInfectedOutput(stdout: string, stderr: string): boolean {
  return /FOUND/i.test(`${stdout}\n${stderr}`);
}

export async function scanFileWithAntivirus(filePath: string): Promise<AvScanResult> {
  if (env.AV_SCAN_MODE === "off") {
    return { status: "clean", details: "AV scan disabled by config" };
  }

  try {
    await execFileAsync(env.AV_COMMAND, ["--no-summary", filePath], {
      timeout: env.AV_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });
    return { status: "clean", details: "No malware detected" };
  } catch (error) {
    if (commandNotFound(error)) {
      if (env.AV_SCAN_MODE === "optional") {
        return { status: "unavailable", details: `AV command not found: ${env.AV_COMMAND}` };
      }
      throw new Error(`AV scanner command is missing: ${env.AV_COMMAND}`);
    }

    const execErr = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    const stdout = execErr.stdout ?? "";
    const stderr = execErr.stderr ?? "";
    if (execErr.code === 1 && parseInfectedOutput(stdout, stderr)) {
      return { status: "infected", details: `${stdout}\n${stderr}`.trim() || "Malware signature detected" };
    }

    if (env.AV_SCAN_MODE === "optional") {
      return {
        status: "unavailable",
        details: `${execErr.message ?? "AV scan failed"}`
      };
    }

    throw new Error(`AV scan failed: ${execErr.message ?? "unknown scanner error"}`);
  }
}
