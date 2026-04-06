import { Type } from "typebox";
import type { Static } from "typebox";

export const SplitDirectionSchema = Type.Union([
  Type.Literal("horizontal"),
  Type.Literal("vertical"),
]);
export type SplitDirection = Static<typeof SplitDirectionSchema>;

export const RectSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
});
export type Rect = Static<typeof RectSchema>;

// LayoutNode 是递归联合类型，TypeBox v1 不支持 Type.Recursive。
// Schema 用 T.Any() 表示递归节点，TS 类型保持手写以获得精确推导。

export const LayoutNodeSchema = Type.Union([
  Type.Object({ type: Type.Literal("leaf"), tabId: Type.String() }),
  Type.Object({
    type: Type.Literal("split"),
    direction: SplitDirectionSchema,
    ratio: Type.Number(),
    left: Type.Any(),
    right: Type.Any(),
  }),
]);

// 手写递归类型，与 layout-tree.ts 中的定义一致
export type LayoutNode =
  | { type: "leaf"; tabId: string }
  | {
      type: "split";
      direction: SplitDirection;
      ratio: number;
      left: LayoutNode;
      right: LayoutNode;
    };
