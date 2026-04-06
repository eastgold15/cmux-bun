/**
 * 通知呼吸灯动画
 * 根据 tab 状态驱动 pane 边框颜色动画
 */

export type AnimationState = "idle" | "processing" | "attention";

interface BreathingConfig {
  /** 基础颜色 */
  baseColor: string;
  /** 呼吸周期 (ms) */
  period: number;
  /** 最低亮度 [0, 1] */
  minBrightness: number;
  /** 最高亮度 [0, 1] */
  maxBrightness: number;
}

const CONFIGS: Record<Exclude<AnimationState, "idle">, BreathingConfig> = {
  processing: {
    baseColor: "#4488ff",
    period: 1500,
    minBrightness: 0.3,
    maxBrightness: 1.0,
  },
  attention: {
    baseColor: "#ff4444",
    period: 800,
    minBrightness: 0.3,
    maxBrightness: 1.0,
  },
};

const IDLE_COLOR = "#333333";

/** 获取呼吸灯动画颜色 */
export function getAnimatedBorderColor(state: AnimationState): string {
  if (state === "idle") return IDLE_COLOR;

  const { baseColor, period, minBrightness, maxBrightness } = CONFIGS[state];
  // sin 值范围 [-1, 1]，映射到 [minBrightness, maxBrightness]
  const sin = Math.sin(Date.now() / (period / (2 * Math.PI)));
  const brightness = minBrightness + (maxBrightness - minBrightness) * (0.5 + 0.5 * sin);

  return scaleColor(baseColor, brightness);
}

/** 将 hex 颜色按亮度缩放 */
function scaleColor(hex: string, brightness: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * brightness);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * brightness);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * brightness);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
