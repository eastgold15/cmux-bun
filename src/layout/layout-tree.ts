/**
 * 分屏布局引擎 —— 用树结构管理任意分屏
 *
 * LayoutNode:
 *   leaf  → 绑定一个 tabId，渲染终端内容
 *   split → 左右或上下分割，包含两个子节点
 */

export type LayoutNode =
  | { type: "leaf"; tabId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      ratio: number; // 0~1，左/上子节点占比
      left: LayoutNode;
      right: LayoutNode;
    };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 根据窗口尺寸递归计算每个 leaf 节点的渲染区域
 */
export function resolveRects(node: LayoutNode, bounds: Rect): Map<string, Rect> {
  const result = new Map<string, Rect>();
  resolve(node, bounds, result);
  return result;
}

function resolve(node: LayoutNode, bounds: Rect, out: Map<string, Rect>) {
  if (node.type === "leaf") {
    out.set(node.tabId, { ...bounds });
    return;
  }

  const { direction, ratio, left, right } = node;

  if (direction === "horizontal") {
    const splitX = Math.round(bounds.x + bounds.width * ratio);
    resolve(left, { x: bounds.x, y: bounds.y, width: splitX - bounds.x, height: bounds.height }, out);
    resolve(right, { x: splitX, y: bounds.y, width: bounds.x + bounds.width - splitX, height: bounds.height }, out);
  } else {
    const splitY = Math.round(bounds.y + bounds.height * ratio);
    resolve(left, { x: bounds.x, y: bounds.y, width: bounds.width, height: splitY - bounds.y }, out);
    resolve(right, { x: bounds.x, y: splitY, width: bounds.width, height: bounds.y + bounds.height - splitY }, out);
  }
}

/**
 * 在指定 leaf 节点处执行分屏操作
 * 将原 leaf 替换为 split，原 leaf 成为左子节点，新 tab 成为右子节点
 */
export function splitLeaf(
  root: LayoutNode,
  targetTabId: string,
  newTabId: string,
  direction: "horizontal" | "vertical",
  ratio = 0.5,
): LayoutNode {
  if (root.type === "leaf") {
    if (root.tabId === targetTabId) {
      return {
        type: "split",
        direction,
        ratio,
        left: { type: "leaf", tabId: targetTabId },
        right: { type: "leaf", tabId: newTabId },
      };
    }
    return root;
  }

  return {
    ...root,
    left: splitLeaf(root.left, targetTabId, newTabId, direction, ratio),
    right: splitLeaf(root.right, targetTabId, newTabId, direction, ratio),
  };
}

/**
 * 移除一个 leaf 节点，用其兄弟节点替换父 split
 */
export function removeLeaf(root: LayoutNode, targetTabId: string): LayoutNode | null {
  if (root.type === "leaf") {
    return root.tabId === targetTabId ? null : root;
  }

  const leftResult = removeLeaf(root.left, targetTabId);
  const rightResult = removeLeaf(root.right, targetTabId);

  // 如果一边被完全移除，返回另一边
  if (leftResult === null && rightResult === null) return null;
  if (leftResult === null) return rightResult;
  if (rightResult === null) return leftResult;

  return { ...root, left: leftResult, right: rightResult };
}

/**
 * 调整分割比例
 */
export function adjustRatio(root: LayoutNode, targetTabId: string, delta: number): LayoutNode {
  if (root.type === "leaf") return root;

  // 如果目标在左子树中，调整当前 split 的 ratio
  if (containsTab(root.left, targetTabId)) {
    return {
      ...root,
      ratio: Math.max(0.1, Math.min(0.9, root.ratio + delta)),
      left: adjustRatio(root.left, targetTabId, delta),
      right: root.right,
    };
  }

  if (containsTab(root.right, targetTabId)) {
    return {
      ...root,
      ratio: Math.max(0.1, Math.min(0.9, root.ratio - delta)),
      left: root.left,
      right: adjustRatio(root.right, targetTabId, delta),
    };
  }

  return root;
}

function containsTab(node: LayoutNode, tabId: string): boolean {
  if (node.type === "leaf") return node.tabId === tabId;
  return containsTab(node.left, tabId) || containsTab(node.right, tabId);
}

/**
 * 收集所有 leaf 的 tabId
 */
export function collectLeaves(node: LayoutNode): string[] {
  if (node.type === "leaf") return [node.tabId];
  return [...collectLeaves(node.left), ...collectLeaves(node.right)];
}

/**
 * 序列化为 JSON（用于持久化到数据库）
 */
export function serializeLayout(node: LayoutNode): string {
  return JSON.stringify(node);
}

/**
 * 从 JSON 反序列化
 */
export function deserializeLayout(json: string): LayoutNode {
  return JSON.parse(json) as LayoutNode;
}
