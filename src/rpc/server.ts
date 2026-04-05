export class RpcServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private handlers = new Map<string, (params: any) => any>();

  on(method: string, handler: (params: any) => any) {
    this.handlers.set(method, handler);
  }

  start(port = 9420) {
    try {
      this.server = Bun.serve({
        port,
        fetch: async (req) => {
          if (req.method === "POST") {
            try {
              const body = await req.json() as { jsonrpc?: string; method: string; params?: any; id?: number };
              const handler = this.handlers.get(body.method);
              if (handler) {
                const result = handler(body.params);
                return Response.json({
                  jsonrpc: "2.0",
                  result,
                  id: body.id,
                });
              }
              return Response.json({
                jsonrpc: "2.0",
                error: { code: -32601, message: "Method not found" },
                id: body.id,
              });
            } catch (e) {
              return Response.json({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal error" },
                id: null,
              });
            }
          }
          return new Response("cmux-bun RPC server", { status: 200 });
        },
      });
    } catch {
      // 端口被占用时不崩溃，RPC 是可选功能
    }
  }

  stop() {
    this.server?.stop();
  }
}
