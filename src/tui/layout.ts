/**
 * BSP (Binary Space Partitioning) 布局树
 * 用于管理分屏布局，支持水平/垂直切分
 */

export type SplitDirection = "horizontal" | "vertical";

export interface LeafNode {
  type: "leaf";
  id: string;
  // 渲染区域（由 layout 引擎计算）
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface SplitNode {
  type: "split";
  direction: SplitDirection;
  ratio: number; // 0.0 ~ 1.0，左侧/上侧占比
  left: LayoutNode;
  right: LayoutNode;
  // 渲染区域
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export type LayoutNode = LeafNode | SplitNode;

/**
 * 计算布局树中所有叶子节点的绝对坐标
 */
export function computeLayout(
  node: LayoutNode,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  node.x = x;
  node.y = y;
  node.width = width;
  node.height = height;

  if (node.type === "split") {
    if (node.direction === "horizontal") {
      const leftWidth = Math.floor(width * node.ratio);
      const rightWidth = width - leftWidth;
      computeLayout(node.left, x, y, leftWidth, height);
      computeLayout(node.right, x + leftWidth, y, rightWidth, height);
    } else {
      const topHeight = Math.floor(height * node.ratio);
      const bottomHeight = height - topHeight;
      computeLayout(node.left, x, y, width, topHeight);
      computeLayout(node.right, x, y + topHeight, width, bottomHeight);
    }
  }
}

/**
 * 在指定叶子节点处切分
 * 返回新的根节点（如果替换了根的话）
 */
export function splitNode(
  root: LayoutNode,
  leafId: string,
  direction: SplitDirection,
  ratio = 0.5
): LayoutNode {
  if (root.type === "leaf") {
    if (root.id === leafId) {
      const newLeaf: LeafNode = { type: "leaf", id: `pane-${Date.now()}` };
      return {
        type: "split",
        direction,
        ratio,
        left: root,
        right: newLeaf,
      };
    }
    return root;
  }

  // 递归查找
  root.left = splitNode(root.left, leafId, direction, ratio);
  root.right = splitNode(root.right, leafId, direction, ratio);
  return root;
}

/**
 * 移除一个叶子节点，如果兄弟也是叶子则用兄弟替换父节点
 * 返回新的根
 */
export function removeNode(root: LayoutNode, leafId: string): LayoutNode | null {
  if (root.type === "leaf") {
    return root.id === leafId ? null : root;
  }

  // 检查直接子节点
  if (root.left.type === "leaf" && root.left.id === leafId) {
    return root.right;
  }
  if (root.right.type === "leaf" && root.right.id === leafId) {
    return root.left;
  }

  // 递归
  const newLeft = removeNode(root.left, leafId);
  const newRight = removeNode(root.right, leafId);

  if (newLeft === null) return root.right;
  if (newRight === null) return root.left;

  root.left = newLeft;
  root.right = newRight;
  return root;
}

/**
 * 获取所有叶子节点
 */
export function getLeaves(node: LayoutNode): LeafNode[] {
  if (node.type === "leaf") return [node];
  return [...getLeaves(node.left), ...getLeaves(node.right)];
}

/**
 * 查找指定 ID 的叶子节点
 */
export function findLeaf(node: LayoutNode, id: string): LeafNode | null {
  if (node.type === "leaf") return node.id === id ? node : null;
  return findLeaf(node.left, id) ?? findLeaf(node.right, id);
}

/**
 * 按方向获取相邻叶子节点
 */
export function getAdjacentLeaf(
  root: LayoutNode,
  leafId: string,
  direction: "up" | "down" | "left" | "right"
): LeafNode | null {
  const leaves = getLeaves(root);
  const current = leaves.find((l) => l.id === leafId);
  if (!current || current.x === undefined || current.y === undefined) return null;

  const cx = current.x + (current.width ?? 0) / 2;
  const cy = current.y + (current.height ?? 0) / 2;

  let best: LeafNode | null = null;
  let bestDist = Infinity;

  for (const leaf of leaves) {
    if (leaf.id === leafId || leaf.x === undefined || leaf.y === undefined) continue;
    const lx = leaf.x + (leaf.width ?? 0) / 2;
    const ly = leaf.y + (leaf.height ?? 0) / 2;

    let valid = false;
    let dist = Infinity;

    switch (direction) {
      case "left":
        valid = lx < cx;
        dist = cx - lx;
        break;
      case "right":
        valid = lx > cx;
        dist = lx - cx;
        break;
      case "up":
        valid = ly < cy;
        dist = cy - ly;
        break;
      case "down":
        valid = ly > cy;
        dist = ly - cy;
        break;
    }

    if (valid && dist < bestDist) {
      bestDist = dist;
      best = leaf;
    }
  }

  return best;
}

/**
 * 序列化为 JSON（用于 DB 持久化）
 */
export function serializeLayout(node: LayoutNode): object {
  if (node.type === "leaf") {
    return { type: "leaf", id: node.id };
  }
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    left: serializeLayout(node.left),
    right: serializeLayout(node.right),
  };
}

/**
 * 从 JSON 反序列化
 */
export function deserializeLayout(data: any): LayoutNode {
  if (data.type === "leaf") {
    return { type: "leaf", id: data.id };
  }
  return {
    type: "split",
    direction: data.direction,
    ratio: data.ratio ?? 0.5,
    left: deserializeLayout(data.left),
    right: deserializeLayout(data.right),
  };
}
