/**
 * 在指定 cwd 下执行 git 命令，返回 stdout（trim 后）。
 * 失败时返回 null。
 */
function gitCommand(args: string[], cwd: string): string | null {
  try {
    const proc = Bun.spawnSync(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 3000,
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

/** 获取当前分支名，如 "main"、"feature/login" */
export function getGitBranch(cwd: string): string | null {
  return gitCommand(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

/** 获取短 commit hash */
export function getGitShortHash(cwd: string): string | null {
  return gitCommand(["rev-parse", "--short", "HEAD"], cwd);
}
