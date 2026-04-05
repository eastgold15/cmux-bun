import { createMachine, assign } from "xstate";

export const appMachine = createMachine({
  id: "cmux-core",
  context: {
    activeTabId: null as string | null,
    tabs: [] as any[],
  },
  initial: "loading",
  states: {
    loading: {
      invoke: {
        src: "loadTabsFromDb", // 从 Drizzle 读取数据
        onDone: {
          target: "idle",
          actions: assign({ tabs: ({ event }) => event.output })
        }
      }
    },
    idle: {
      on: {
        CREATE_TAB: "creatingTab",
        SWITCH_TAB: {
          actions: assign({ activeTabId: ({ event }) => event.tabId })
        }
      }
    },
    creatingTab: {
      // 调用 Drizzle 插入数据，同时调用 TerminalManager 创建 PTY
      invoke: {
        src: "setupNewTab",
        onDone: "idle"
      }
    }
  }
});