/**
 * cmux-bun 主题系统
 * 集中管理所有颜色定义，避免硬编码
 */

export const theme = {
  // 侧边栏
  sidebar: {
    bg: "#1a1a2e",
    border: "#444444",
    title: "#00ff88",
    tabActiveBg: "#2a2a4e",
    tabInactiveFg: "#888888",
    tabCwdFg: "#555555",
  },

  // 视窗
  viewport: {
    bg: "#000000",
    borderIdle: "#333333",
    borderBusy: "#4488ff",
    borderAttention: "#ffaa00",
    borderActive: "#00ff88",
  },

  // 状态栏
  statusBar: {
    bg: "#1a1a2e",
    fg: "#888888",
  },

  // Tab 指示器
  indicator: {
    idle: "#888888",
    active: "#00ff88",
    busy: "#4488ff",
    attention: "#ff4444",
    unread: "#ffaa00",
  },

  // 终端默认
  terminal: {
    fg: "#ffffff",
    bg: "#000000",
    welcome: "#888888",
  },

  // 搜索 Overlay
  overlay: {
    bg: "#1a1a2e",
    border: "#00ff88",
    fg: "#ffffff",
    selectedBg: "#2a2a4e",
    selectedFg: "#00ff88",
    hintFg: "#888888",
    timeFg: "#666666",
  },
} as const;

export type Theme = typeof theme;
