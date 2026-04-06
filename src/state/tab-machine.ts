import { createMachine, assign, createActor } from "xstate";
import type { AgentLifecycle } from "../contracts/tab.js";

export interface TabContext {
  id: string;
  name: string;
  cwd: string;
  lastOutput: string[];
  agentStatus: AgentLifecycle;
  agentTask: string;
  agentError: string;
}

export const tabMachine = createMachine({
  id: "tab",
  initial: "idle",
  context: {
    id: "",
    name: "",
    cwd: "",
    lastOutput: [] as string[],
    agentStatus: "idle" as AgentLifecycle,
    agentTask: "",
    agentError: "",
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
        AGENT_STARTED: {
          actions: assign({
            agentStatus: () => "busy" as AgentLifecycle,
            agentTask: ({ event }: any) => (event as any).task,
            agentError: () => "",
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
        AGENT_STARTED: {
          actions: assign({
            agentStatus: () => "busy" as AgentLifecycle,
            agentTask: ({ event }: any) => (event as any).task,
            agentError: () => "",
          }),
        },
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
        AGENT_STARTED: {
          actions: assign({
            agentStatus: () => "busy" as AgentLifecycle,
            agentTask: ({ event }: any) => (event as any).task,
            agentError: () => "",
          }),
        },
      },
    },
  },
  // Agent lifecycle 事件在任何状态都可触发 completed/error/ack
  on: {
    AGENT_COMPLETED: {
      actions: assign({
        agentStatus: () => "success" as AgentLifecycle,
        agentError: () => "",
      }),
    },
    AGENT_ERROR: {
      actions: assign({
        agentStatus: () => "error" as AgentLifecycle,
        agentError: ({ event }: any) => (event as any).error,
      }),
    },
    AGENT_ACK: {
      actions: assign({
        agentStatus: () => "idle" as AgentLifecycle,
        agentTask: () => "",
        agentError: () => "",
      }),
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
      agentStatus: "idle" as AgentLifecycle,
      agentTask: "",
      agentError: "",
    },
  });
}
