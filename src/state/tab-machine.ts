import { createMachine, assign, createActor } from "xstate";

export interface TabContext {
  id: string;
  name: string;
  cwd: string;
  lastOutput: string[];
}

export const tabMachine = createMachine({
  id: "tab",
  initial: "idle",
  context: {
    id: "",
    name: "",
    cwd: "",
    lastOutput: [] as string[],
  },
  states: {
    idle: {
      on: {
        DATA_RECEIVED: {
          target: "processing",
          actions: assign({
            lastOutput: ({ context, event }: any) =>
              [...context.lastOutput, (event as any).data].slice(-50),
          }),
        },
      },
    },
    processing: {
      on: {
        DATA_RECEIVED: [
          {
            target: "attention",
            guard: ({ event }: any) =>
              /\(y\/n\)|\?\s*\[Y\/n\]|\(yes\/no\)|continue\?/i.test((event as any).data),
            actions: assign({
              lastOutput: ({ context, event }: any) =>
                [...context.lastOutput, (event as any).data].slice(-50),
            }),
          },
          {
            target: "processing",
            actions: assign({
              lastOutput: ({ context, event }: any) =>
                [...context.lastOutput, (event as any).data].slice(-50),
            }),
          },
        ],
        PROCESS_EXITED: "idle",
        USER_INPUT: "processing",
        DETECT_NOTIFY_SIGNAL: "attention",
      },
    },
    attention: {
      on: {
        USER_INPUT: "processing",
        PROCESS_EXITED: "idle",
        DATA_RECEIVED: {
          target: "processing",
          actions: assign({
            lastOutput: ({ context, event }: any) =>
              [...context.lastOutput, (event as any).data].slice(-50),
          }),
        },
      },
    },
  },
});

export function createTabActor(tabId: string, name: string, cwd: string) {
  return createActor(tabMachine, {
    input: {
      id: tabId,
      name,
      cwd,
      lastOutput: [],
    },
  });
}
