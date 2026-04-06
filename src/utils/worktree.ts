import { readFileSync, existsSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";

/**
 * Git Worktree 工具函数
 *
 * 约定：worktree 存放在主仓库同级的 .git-worktrees/项目名/分支名 目录下。
 * 例：主仓库 L:\Documents\GitHub\cmux-bun
 *     → worktree L:\Documents\GitHub\.git-worktrees\cmux-bun\feat-ui
 */

/** 在指定 cwd 下执行 git 命令，返回 stdout（trim 后）。失败返回 null */
function gitCommand(args: string[], cwd: string): string | null {
  try {
    const proc = Bun.spawnSync(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * 解析真实 .git 目录路径。
 * - 普通仓库：cwd/.git 就是目录，直接返回
 * - Worktree：cwd/.git 是一个文件，内容为 "gitdir: /path/to/main/.git/worktrees/<name>"
 */
export function resolveGitDir(cwd: string): string | null {
  const gitPath = join(cwd, ".git");
  if (!existsSync(gitPath)) return null;

  try {
    const stat = statSync(gitPath);
    if (stat.isDirectory()) {
      return gitPath;
    }
    // 是文件 → worktree，读取 gitdir 指向
    const content = readFileSync(gitPath, "utf-8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (match) return match[1]!;
    return null;
  } catch {
    return null;
  }
}

/** 判断 cwd 是否在 git worktree 中（.git 是文件而非目录） */
export function isWorktree(cwd: string): boolean {
  const gitPath = join(cwd, ".git");
  if (!existsSync(gitPath)) return false;
  try {
    return !statSync(gitPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 从 worktree 的 cwd 追溯主仓库路径。
 * 读取 cwd/.git 文件中的 gitdir，剥离 /worktrees/<name> 后缀。
 */
export function getMainRepoPath(cwd: string): string | null {
  const gitPath = join(cwd, ".git");
  if (!existsSync(gitPath)) return null;

  try {
    const stat = statSync(gitPath);
    if (stat.isDirectory()) return cwd; // 自己就是主仓库

    const content = readFileSync(gitPath, "utf-8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) return null;

    // gitdir 指向 main/.git/worktrees/<name>
    // 需要回溯到 main/.git → main
    const gitdir = match[1]!.replace(/\\/g, "/");
    const worktreeIdx = gitdir.indexOf("/worktrees/");
    if (worktreeIdx === -1) return null;

    const mainGitDir = gitdir.substring(0, worktreeIdx);
    // mainGitDir 是 main/.git，往上走一层就是主仓库
    return dirname(mainGitDir);
  } catch {
    return null;
  }
}

/**
 * 生成 worktree 存放路径（约定大于配置）。
 * 格式：主仓库的父目录/.git-worktrees/项目名/分支名
 */
export function getWorktreeStoragePath(mainRepoPath: string, branch: string): string {
  const repoName = basename(mainRepoPath);
  return join(dirname(mainRepoPath), ".git-worktrees", repoName, branch);
}

/**
 * 创建 git worktree 并返回路径信息。
 */
export function createWorktree(params: {
  mainRepoPath: string;
  branch: string;
  basePath?: string;
}): { path: string; branch: string } {
  const { mainRepoPath, branch } = params;
  const targetPath = params.basePath ?? getWorktreeStoragePath(mainRepoPath, branch);

  const result = Bun.spawnSync(
    ["git", "worktree", "add", targetPath, branch],
    {
      cwd: mainRepoPath,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
    },
  );

  if (result.exitCode !== 0) {
    const stderr = result.stderr?.toString().trim() ?? "unknown error";
    throw new Error(`git worktree add 失败: ${stderr}`);
  }

  return { path: targetPath, branch };
}

/** 移除 git worktree */
export function removeWorktree(
  worktreePath: string,
  force = false,
): boolean {
  const args = ["git", "worktree", "remove", worktreePath];
  if (force) args.push("--force");

  const result = Bun.spawnSync(args, {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15000,
  });

  return result.exitCode === 0;
}

/** 列出所有 worktree */
export function listWorktrees(mainRepoPath: string): { path: string; branch: string; isMain: boolean }[] {
  const output = gitCommand(["worktree", "list", "--porcelain"], mainRepoPath);
  if (!output) return [];

  const worktrees: { path: string; branch: string; isMain: boolean }[] = [];
  let currentPath = "";
  let currentBranch = "";
  let isCurrentMain = false;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.substring("worktree ".length);
      isCurrentMain = false;
    } else if (line.startsWith("branch ")) {
      currentBranch = line.substring("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "bare") {
      isCurrentMain = true;
    } else if (line === "" && currentPath) {
      worktrees.push({ path: currentPath, branch: currentBranch, isMain: isCurrentMain });
      currentPath = "";
      currentBranch = "";
      isCurrentMain = false;
    }
  }
  // 处理最后一个（如果没有空行结尾）
  if (currentPath) {
    worktrees.push({ path: currentPath, branch: currentBranch, isMain: isCurrentMain });
  }

  return worktrees;
}
