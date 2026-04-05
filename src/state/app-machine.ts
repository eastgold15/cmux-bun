import { createMachine, assign, createActor } from "xstate";

export interface AppContext {
  activeTabId: string | null;
  tabIds: string[];
}

export const appMachine = createMachine({
  id: "app",
  initial: "running",
  context: {
    activeTabId: null as string | null,
    tabIds: [] as string[],
  },
  states: {
    running: {
      on: {
        ADD_TAB: {
          actions: assign({
            tabIds: ({ context, event }) => [...context.tabIds, event.tabId],
            activeTabId: ({ context, event }) =>
              context.activeTabId ?? event.tabId,
          }),
        },
        REMOVE_TAB: {
          actions: assign({
            tabIds: ({ context, event }) =>
              context.tabIds.filter((id) => id !== event.tabId),
            activeTabId: ({ context, event }) => {
              if (context.activeTabId !== event.tabId) return context.activeTabId;
              const remaining = context.tabIds.filter((id) => id !== event.tabId);
              return remaining[0] ?? null;
            },
          }),
        },
        SWITCH_TAB: {
          actions: assign({
            activeTabId: ({ event }) => event.tabId,
          }),
        },
        SWITCH_TAB_INDEX: {
          actions: assign({
            activeTabId: ({ context, event }) =>
              context.tabIds[event.index] ?? context.activeTabId,
          }),
        },
      },
    },
  },
});

export function createAppActor() {
  return createActor(appMachine);
}
