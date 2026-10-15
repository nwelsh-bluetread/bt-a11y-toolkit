/**
 * PDF/UA-1 support for the summary PDF.
 *
 * Chrome's tagged PDF needs a post-processing pass (assets/pdf/pdfua_fix.py,
 * which uses the Python library pikepdf) to pass PDF/UA-1. So every machine
 * gets the same result, the toolkit installs pikepdf into its own virtual
 * environment at ~/.bt-a11y/pdf-venv the first time it's needed, then verifies
 * each PDF with veraPDF when that's installed.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PDF_VENV = join(homedir(), ".bt-a11y", "pdf-venv");
const VENV_PYTHON = join(PDF_VENV, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** Run a command; resolves with its exit code and output (never rejects). */
function run(cmd: string, args: string[], timeout = 300_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

async function hasPikepdf(python: string): Promise<boolean> {
  return (await run(python, ["-c", "import pikepdf"], 30_000)).code === 0;
}

/** A Python that can import pikepdf, if one exists already. */
export async function findPdfUaPython(): Promise<string | undefined> {
  const candidates = [
    process.env.PDFUA_PYTHON,
    VENV_PYTHON,
    join(homedir(), ".claude/skills/a11y-report-pdf/.venv/bin/python"),
    "python3",
  ].filter((p): p is string => Boolean(p));
  for (const python of candidates) {
    if ((python.includes("/") || python.includes("\\")) && !existsSync(python)) continue;
    if (await hasPikepdf(python)) return python;
  }
  return undefined;
}

/**
 * Make sure pikepdf is available, installing it into ~/.bt-a11y/pdf-venv if
 * needed. Returns the Python to use; throws with a readable message if Python
 * itself is missing or the install fails (e.g. offline).
 */
export async function ensurePdfUaPython(log: (line: string) => void = () => {}): Promise<string> {
  const existing = await findPdfUaPython();
  if (existing) return existing;

  const base = (await run("python3", ["--version"], 30_000)).code === 0 ? "python3" : (await run("python", ["--version"], 30_000)).code === 0 ? "python" : undefined;
  if (!base) {
    throw new Error("Python 3 isn't installed. On a Mac, run `xcode-select --install` (or install Python from python.org), then run the report again.");
  }

  log(`Setting up PDF accessibility support (one time, installs pikepdf into ${PDF_VENV})…`);
  if (!existsSync(VENV_PYTHON)) {
    const venv = await run(base, ["-m", "venv", PDF_VENV]);
    if (venv.code !== 0) throw new Error(`Couldn't create a Python environment at ${PDF_VENV}:\n${venv.out.trim()}`);
  }
  const pip = await run(VENV_PYTHON, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "pikepdf"]);
  if (pip.code !== 0 || !(await hasPikepdf(VENV_PYTHON))) {
    throw new Error(`Couldn't install pikepdf (are you online?):\n${pip.out.trim().split("\n").slice(-5).join("\n")}`);
  }
  log("PDF accessibility support installed.");
  return VENV_PYTHON;
}

export type VerifyResult = { status: "pass" } | { status: "fail"; failedRules: number; details: string } | { status: "unavailable" };

/** Check a PDF against PDF/UA-1 with veraPDF, if it's installed. */
export async function verifyPdfUa(pdfPath: string): Promise<VerifyResult> {
  return parseVeraPdf((await run("verapdf", ["--flavour", "ua1", pdfPath], 180_000)).out);
}

/** Read veraPDF's XML report. Anything without a verdict (e.g. veraPDF not installed) is "unavailable". */
export function parseVeraPdf(xml: string): VerifyResult {
  const compliant = /isCompliant="(true|false)"/.exec(xml)?.[1];
  if (!compliant) return { status: "unavailable" };
  if (compliant === "true") return { status: "pass" };
  const rules = [...xml.matchAll(/<rule [^>]*clause="([^"]+)"[^>]*testNumber="([^"]+)"[^>]*status="failed"/g)].map((m) => `${m[1]}-${m[2]}`);
  return {
    status: "fail",
    failedRules: Number(/failedRules="(\d+)"/.exec(xml)?.[1] ?? rules.length),
    details: [...new Set(rules)].slice(0, 10).join(", "),
  };
}

/** Whether a command is on the PATH (for the setup check). */
export async function hasCommand(cmd: string, args = ["--version"]): Promise<boolean> {
  return (await run(cmd, args, 30_000)).code === 0;
}
