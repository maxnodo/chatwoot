import { authorizeDispatch } from "../functions/_shared/dispatch-auth.ts";

function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
Deno.test("auth rejects missing/invalid secrets and fails closed", async () => {
  let calls = 0;
  const rpc = async () => { calls++; return { data: false, error: null }; };
  assert((await authorizeDispatch(new Request("https://test", { method: "POST" }), { rpc }))?.status === 401, "missing token accepted");
  assert(calls === 0, "missing token queried database");
  const request = new Request("https://test", { method: "POST", headers: { "x-nodo-dispatch-token": "wrong" } });
  assert((await authorizeDispatch(request, { rpc }))?.status === 401, "invalid token accepted");
  assert((await authorizeDispatch(request, { rpc: async () => ({ error: true }) }))?.status === 503, "database failure accepted");
  assert(await authorizeDispatch(request, { rpc: async () => ({ data: true }) }) === null, "valid token rejected");
});

Deno.env.set("SUPABASE_URL", "https://database.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");
Deno.env.set("EVOLUTION_URL", "https://evolution.test");
Deno.env.set("EVOLUTION_INSTANCE", "test");
Deno.env.set("EVOLUTION_API_KEY", "test-key");
let handler: (req: Request) => Promise<Response>;
Deno.serve = ((fn: typeof handler) => { handler = fn; return {}; }) as unknown as typeof Deno.serve;
await import("../functions/dispatch-scheduled-messages/index.ts");
const individual = handler!;
await import("../functions/dispatch-group-messages/index.ts");
const group = handler!;
const originalFetch = globalThis.fetch;

for (const [name, run, table, failureStatus] of [
  ["individual", individual, "nodo_scheduled_messages", "failed"],
  ["group", group, "nodo_scheduled_group_messages", "error"],
] as const) {
  for (const scenario of ["concurrent", "cancelled", "network failure"] as const) {
    Deno.test(`${name}: ${scenario}`, async () => {
      let sends = 0;
      const row: Record<string, unknown> = { id: 1, status: "pending", attempts: 0, account_id: 1, inbox_id: 1, conversation_id: 1, content: "synthetic", group_jid: "test@g.us" };
      const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname !== "database.test") {
          sends++;
          if (scenario === "network failure") return Promise.reject(new Error("Connection lost after submission"));
          return reply({ id: 99 });
        }
        if (url.pathname.endsWith("/rpc/nodo_dispatch_authorized")) return reply(true);
        const target = url.pathname.split("/").pop();
        if (target === table) {
          if (init?.method === "PATCH") {
            if (scenario === "cancelled" && row.status === "pending") row.status = "cancelled";
            const status = url.searchParams.get("status")?.replace("eq.", "");
            if (status !== row.status) return reply([]);
            Object.assign(row, JSON.parse(String(init.body)));
            return reply([{ ...row }]);
          }
          return reply(row.status === "pending" ? [{ ...row }] : []);
        }
        if (target === "inboxes") return reply([{ id: 1, account_id: 1, channel_type: "Channel::Api" }]);
        if (target === "conversations") return reply([{ id: 1, account_id: 1, inbox_id: 1, display_id: 1 }]);
        if (target === "account_users") return reply([{ user_id: 1 }]);
        if (target === "access_tokens") return reply([{ token: "synthetic-token" }]);
        throw new Error(`Unexpected request: ${url.pathname}`);
      }) as typeof fetch;
      const request = () => new Request("https://dispatch.test", { method: "POST", headers: { "x-nodo-dispatch-token": "synthetic" } });
      try {
        await Promise.all([run(request()), run(request())]);
        assert(sends === (scenario === "cancelled" ? 0 : 1), `send count ${sends}`);
        assert(row.status === (scenario === "cancelled" ? "cancelled" : scenario === "network failure" ? failureStatus : "sent"), `unexpected state ${row.status}`);
        await run(request());
        assert(sends <= 1, "terminal/uncertain message retried");
      } finally { globalThis.fetch = originalFetch; }
    });
  }
}
