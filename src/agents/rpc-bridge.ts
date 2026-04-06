import { createHandlers, type AgentContext } from "./handlers.js";

/**
 * JSON-RPC 2.0 over HTTP（端口 9420）—— 向后兼容的远程控制接口。
 * 复用 handlers.ts 中的共享逻辑。
 */
export class RpcBridge {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private handlers: ReturnType<typeof createHandlers>;

  constructor(ctx: AgentContext) {
    this.handlers = createHandlers(ctx);
  }

  start(port = 9420) {
    try {
      this.server = Bun.serve({
        port,
        fetch: async (req) => {
          if (req.method !== "POST") {
            return new Response("cmux-bun RPC Bridge", { status: 200 });
          }

          try {
            const body = await req.json() as {
              jsonrpc?: string;
              method: string;
              params?: any;
              id?: number | string;
            };

            let result: any;
            switch (body.method) {
              case "list_tabs":
                result = this.handlers.list_tabs();
                break;
              case "create_tab":
                result = this.handlers.create_tab(body.params ?? { name: "Terminal" });
                return Response.json({ jsonrpc: "2.0", result: { tabId: result }, id: body.id });
              case "focus_tab":
                result = this.handlers.focus_tab(body.params);
                break;
              case "close_tab":
                result = this.handlers.close_tab(body.params);
                break;
              case "send_input":
                result = this.handlers.send_input(body.params);
                break;
              case "get_tab_output":
                result = this.handlers.get_tab_output(body.params);
                break;
              case "get_git_context":
                result = this.handlers.get_git_context(body.params);
                break;
              case "create_worktree":
                result = await this.handlers.create_worktree(body.params ?? {});
                break;
              case "remove_worktree":
                result = await this.handlers.remove_worktree(body.params);
                break;
              default:
                return Response.json({
                  jsonrpc: "2.0",
                  error: { code: -32601, message: `Method not found: ${body.method}` },
                  id: body.id,
                });
            }

            return Response.json({ jsonrpc: "2.0", result, id: body.id });
          } catch (e: any) {
            return Response.json({
              jsonrpc: "2.0",
              error: { code: -32603, message: e.message },
              id: null,
            });
          }
        },
      });
    } catch {
      // 端口被占用 —— RPC 是可选的，静默忽略
    }
  }

  stop() {
    this.server?.stop();
  }
}
