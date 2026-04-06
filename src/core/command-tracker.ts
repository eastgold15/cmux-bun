import { addCommand, finishCommand } from "../db/history.js";
import type { AnsiParser } from "../core/parser/ansi-parser.js";

/**
 * 命令历史追踪器
 *
 * 职责：
 * 1. 累积用户输入的可打印字符
 * 2. 检测命令边界（Enter 提交、prompt 检测完成）
 * 3. 写入数据库
 */
export class CommandTracker {
  private pendingCommand = "";
  private activeCommandId: string | null = null;

  // Shell prompt 模式
  private static readonly PROMPT_PATTERN = /[\$#>]\s*$/;
  private static readonly PS_PATTERN = /PS\s+[A-Z]:\\.*>\s*$/;

  /** 处理用户按键，累积命令文本。返回 true 表示已消费该按键（用于命令追踪） */
  feedKey(key: string, tabId: string, cwd: string): boolean {
    if (key === "\r" || key === "\n") {
      // Enter: 记录命令
      const trimmed = this.pendingCommand.trim();
      if (trimmed.length > 0) {
        this.activeCommandId = addCommand(tabId, trimmed, cwd);
      }
      this.pendingCommand = "";
      return true;
    } else if (key === "\x7f" || key === "\x08") {
      // Backspace
      this.pendingCommand = this.pendingCommand.slice(0, -1);
      return true;
    } else if (key === "\x03") {
      // Ctrl+C: 清空累积
      this.pendingCommand = "";
      return true;
    } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
      // 可打印字符
      this.pendingCommand += key;
      return true;
    }
    // 其他控制序列不修改 pendingCommand
    return false;
  }

  /** 检查 PTY 输出中是否出现 shell prompt，标记命令完成 */
  checkPrompt(tabId: string, parser: AnsiParser): void {
    if (!this.activeCommandId) return;
    const lines = parser.getRows();
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
      const line = lines[i]?.trimEnd();
      if (!line) continue;
      if (CommandTracker.PROMPT_PATTERN.test(line) || CommandTracker.PS_PATTERN.test(line)) {
        finishCommand(this.activeCommandId, null);
        this.activeCommandId = null;
        break;
      }
    }
  }

  /** 重置追踪状态 */
  reset(): void {
    this.pendingCommand = "";
    this.activeCommandId = null;
  }

  /** 获取当前累积的命令文本（用于 UI 展示等） */
  getPendingCommand(): string {
    return this.pendingCommand;
  }

  /** 设置待发送命令（从历史搜索选择后） */
  setPendingCommand(cmd: string): void {
    this.pendingCommand = cmd;
  }
}
