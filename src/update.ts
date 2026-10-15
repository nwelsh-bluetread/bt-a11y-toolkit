/**
 * Staying up to date. The toolkit is installed straight from GitHub, so npm
 * records the exact commit in the project's lockfile. `checkForUpdate` compares
 * that with the latest commit on GitHub; `bt-a11y update` reinstalls.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = "nwelsh-bluetread/bt-a11y-toolkit";
export const INSTALL_SPEC = `github:${REPO}`;
export const PACKAGE_NAME = "@bluetread/accessibility-toolkit";

/** The toolkit's own folder (works from dist/ and from src/ under tsx). */
export function toolkitRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * The commit the project has installed, read from its lockfile. Undefined when
 * running from a checkout of the toolkit itself, or when it wasn't installed
 * from GitHub.
 */
export function installedCommit(root = toolkitRoot()): string | undefined {
  const marker = `${sep}node_modules${sep}`;
  if (!root.includes(marker)) return undefined;
  const project = root.slice(0, root.lastIndexOf(marker));
  for (const lock of [join(project, "node_modules", ".package-lock.json"), join(project, "package-lock.json")]) {
    if (!existsSync(lock)) continue;
    try {
      const data = JSON.parse(readFileSync(lock, "utf8")) as { packages?: Record<string, { resolved?: string }> };
      const resolved = data.packages?.[`node_modules/${PACKAGE_NAME}`]?.resolved;
      const sha = resolved && /#([0-9a-f]{7,40})$/.exec(resolved)?.[1];
      if (sha) return sha;
    } catch {
      // Unreadable lockfile — try the next one.
    }
  }
  return undefined;
}

/** The latest commit on GitHub's default branch, or undefined if offline/slow. */
export function latestCommit(timeoutMs = 3000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["ls-remote", `https://github.com/${REPO}.git`, "HEAD"], { timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout) => {
      resolve(err ? undefined : /^([0-9a-f]{40})\s/.exec(stdout)?.[1]);
    });
  });
}

/** Returns the installed and latest commits when a newer version is available. */
export async function checkForUpdate(): Promise<{ installed: string; latest: string } | undefined> {
  if (process.env.BT_A11Y_NO_UPDATE_CHECK) return undefined;
  const installed = installedCommit();
  if (!installed) return undefined;
  const latest = await latestCommit();
  if (!latest || latest.startsWith(installed) || installed.startsWith(latest)) return undefined;
  return { installed, latest };
}

/** How the project depends on the toolkit (e.g. a pinned "#v0.4.0"), from its package.json. */
export function dependencySpec(projectDir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    return pkg.devDependencies?.[PACKAGE_NAME] ?? pkg.dependencies?.[PACKAGE_NAME];
  } catch {
    return undefined;
  }
}
