## 1. 渲染器启用鼠标

- [x] 1.1 在 `src/main.ts` 的 `createCliRenderer` 中添加 `useMouse: true` 选项

## 2. AppUI 鼠标回调接口

- [x] 2.1 在 `src/ui/app.ts` 的 AppUI 类中添加 `onTabClickHandler` 和 `onPaneClickHandler` 私有字段
- [x] 2.2 添加 `onTabClick(handler)` 和 `onPaneClick(handler)` 公共注册方法

## 3. Sidebar Tab 点击绑定

- [x] 3.1 在 `addTab` 方法中给 `tabItem` BoxRenderable 绑定 `onMouseDown`，调用 `onTabClickHandler?.(tabId)`

## 4. Pane 点击绑定

- [x] 4.1 在 `buildPanes` 方法中给新创建的 pane box 绑定 `onMouseDown`，调用 `onPaneClickHandler?.(id)`

## 5. main.ts 注册回调

- [x] 5.1 在 `src/main.ts` 中调用 `ui.onTabClick(tabId => { ... })` 注册 tab 切换逻辑（SWITCH_TAB + setActiveTab + 刷新 parser grid）
- [x] 5.2 在 `src/main.ts` 中调用 `ui.onPaneClick(paneId => { ... })` 注册 pane 聚焦逻辑（focusPane + SWITCH_TAB + 刷新 parser grid）

## 6. 验证

- [x] 6.1 运行 `bun run type-check` 确保无类型错误
- [ ] 6.2 启动应用验证鼠标点击 sidebar tab 可切换
- [ ] 6.3 分屏后验证鼠标点击 pane 可切换焦点
