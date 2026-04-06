import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createHandlers, type AgentContext } from "./handlers.js";

import {
  ListTabsParamsSchema,
  CreateTabParamsSchema,
  CloseTabParamsSchema,
  FocusTabParamsSchema,
  SplitPaneParamsSchema,
  ReadTabOutputParamsSchema,
  SendTerminalInputParamsSchema,
  GetGitStatusParamsSchema,
} from "../contracts/mcp.js";

const MCP_PORT = 9421;
const MCP_PATH = "/mcp";

/**
 * MCP Host：始终启用，Streamable HTTP over Bun.serve（端口 9421）。
 * 使用 Web Standard API（Request/Response），完美适配 Bun 运行时。
 *
 * 让外部 Agent（如 Claude Code）可以观测和操控 cmux 的 Tab/Pty。
 */
export class McpHost {
  private handlers: ReturnType<typeof createHandlers>;
  private httpServer: ReturnType<typeof Bun.serve> | null = null;
  private sessions = new Map<string, { server: Server; transport: WebStandardStreamableHTTPServerTransport }>();

  constructor(ctx: AgentContext) {
    this.handlers = createHandlers(ctx);
  }

  private createServer(): Server {
    const server = new Server(
      { name: "cmux", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    this.registerTools(server);
    return server;
  }

  private registerTools(server: Server) {
    server.setRequestHandler(
      { method: "tools/list" } as any,
      async () => ({
        tools: [
          {
            name: "list_tabs",
            description: "列出所有终端 Tab 及其状态、cwd 和 git 分支",
            inputSchema: ListTabsParamsSchema,
          },
          {
            name: "create_tab",
            description: "创建新的终端 Tab",
            inputSchema: CreateTabParamsSchema,
          },
          {
            name: "close_tab",
            description: "关闭指定终端 Tab",
            inputSchema: CloseTabParamsSchema,
          },
          {
            name: "focus_tab",
            description: "切换聚焦到指定 Tab",
            inputSchema: FocusTabParamsSchema,
          },
          {
            name: "split_pane",
            description: "水平或垂直分割终端面板",
            inputSchema: SplitPaneParamsSchema,
          },
          {
            name: "read_tab_output",
            description: "读取终端 Tab 的最近输出",
            inputSchema: ReadTabOutputParamsSchema,
          },
          {
            name: "send_terminal_input",
            description: "向终端 Tab 发送文本输入",
            inputSchema: SendTerminalInputParamsSchema,
          },
          {
            name: "get_git_context",
            description: "获取 Tab 的 git 上下文坐标（分支名 + cwd）。不提供具体 diff —— Agent 自己会查",
            inputSchema: GetGitStatusParamsSchema,
          },
        ],
      }),
    );

    server.setRequestHandler(
      { method: "tools/call" } as any,
      async (request: any) => {
        const { name, arguments: args = {} } = request.params;
        try {
          let result: any;
          switch (name) {
            case "list_tabs":
              result = this.handlers.list_tabs();
              break;
            case "create_tab":
              result = this.handlers.create_tab({
                name: args.name ?? "Terminal",
                cwd: args.cwd,
                shell: args.shell,
              });
              return { content: [{ type: "text" as const, text: JSON.stringify({ tabId: result }) }] };
            case "close_tab":
              this.handlers.close_tab({ tabId: args.tabId });
              return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
            case "focus_tab":
              this.handlers.focus_tab({ tabId: args.tabId });
              return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
            case "split_pane":
              this.handlers.split_pane({
                targetTabId: args.targetTabId,
                direction: args.direction,
              });
              return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
            case "read_tab_output":
              result = this.handlers.get_tab_output({
                tabId: args.tabId,
                lines: args.lines,
              });
              break;
            case "send_terminal_input": {
              const tabId = args.tabId;
              const data = args.pressEnter ? args.text + "\r" : args.text;
              this.handlers.send_input({ tabId, data });
              return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
            }
            case "get_git_context":
              result = this.handlers.get_git_context({ tabId: args.tabId });
              break;
            default:
              throw new Error(`Unknown tool: ${name}`);
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (e: any) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: e.message }) }],
            isError: true,
          };
        }
      },
    );
  }

  start() {
    this.httpServer = Bun.serve({
      port: MCP_PORT,
      fetch: async (req) => {
        const url = new URL(req.url);

        if (url.pathname === MCP_PATH) {
          if (req.method === "DELETE") {
            // 会话关闭
            const sessionId = req.headers.get("mcp-session-id");
            if (sessionId) {
              const session = this.sessions.get(sessionId);
              if (session) {
                await session.transport.close();
                this.sessions.delete(sessionId);
              }
            }
            return new Response(null, { status: 204 });
          }

          // 获取或创建会话
          const sessionId = req.headers.get("mcp-session-id");
          let session = sessionId ? this.sessions.get(sessionId) : undefined;

          if (!session) {
            // 新会话
            const server = this.createServer();
            const transport = new WebStandardStreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
            });
            await server.connect(transport);
            session = { server, transport };
            // 从 transport 获取 sessionId 并缓存
            // 注意：transport 在第一次请求后才分配 sessionId
          }

          try {
            const response = await session.transport.handleRequest(req);
            // 缓存会话（首次请求后 transport 有了 sessionId）
            if (session.transport.sessionId) {
              this.sessions.set(session.transport.sessionId, session);
            }
            return response;
          } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        return new Response("cmux MCP Server\n", { status: 200 });
      },
    });
  }

  stop() {
    this.httpServer?.stop();
    for (const [, session] of this.sessions) {
      session.transport.close();
    }
    this.sessions.clear();
  }
}
