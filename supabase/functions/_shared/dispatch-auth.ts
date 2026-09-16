// Cron sends a Vault-backed secret. Only service_role can call the verifier.
export async function authorizeDispatch(req: Request, supabase: { rpc: Function }): Promise<Response | null> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const token = req.headers.get("x-nodo-dispatch-token");
  if (!token) return new Response("Unauthorized", { status: 401 });
  const { data, error } = await supabase.rpc("nodo_dispatch_authorized", { provided_token: token });
  if (error) return new Response("Authorization unavailable", { status: 503 });
  return data === true ? null : new Response("Unauthorized", { status: 401 });
}
