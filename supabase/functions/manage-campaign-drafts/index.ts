import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedAccounts = [1, 25];
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-chatwoot-account-id, x-chatwoot-conversation-display-id, x-chatwoot-conversation-id, x-chatwoot-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...headers, "Content-Type": "application/json" },
});

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return reply({ error: "Invalid JSON body" }, 400);

  const action = String(body.action ?? "").trim().toLowerCase();
  const accountId = Number(req.headers.get("x-chatwoot-account-id") ?? body.account_id);
  const conversationId = Number(req.headers.get("x-chatwoot-conversation-display-id") ?? req.headers.get("x-chatwoot-conversation-id") ?? body.conversation_id);
  const draftId = Number(body.draft_id);
  const userHeader = req.headers.get("x-chatwoot-user-id");
  const userId = userHeader && Number.isInteger(Number(userHeader)) ? Number(userHeader) : null;
  if (!allowedAccounts.includes(accountId) || !Number.isInteger(conversationId) || conversationId < 1 || !Number.isInteger(draftId) || draftId < 1) {
    return reply({ error: "Valid account_id, conversation_id and draft_id are required" }, 400);
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (action === "approve") {
      const sendAtText = String(body.send_at ?? "").trim();
      const sendAt = new Date(sendAtText);
      if (!sendAtText || Number.isNaN(sendAt.getTime())) return reply({ error: "send_at must be ISO 8601" }, 400);
      const { data, error } = await sb.rpc("nodo_approve_campaign_draft", {
        p_account_id: accountId, p_conversation_display_id: conversationId, p_draft_id: draftId,
        p_send_at: sendAt.toISOString(), p_user_id: userId,
      });
      if (error) throw error;
      return reply({ ok: true, ...data, message: `DRAFT-${draftId} aprobado. Se programó como SCHED-${data.scheduled_id}.` });
    }
    if (action === "reject") {
      const { data, error } = await sb.rpc("nodo_reject_campaign_draft", {
        p_account_id: accountId, p_conversation_display_id: conversationId, p_draft_id: draftId, p_user_id: userId,
      });
      if (error) throw error;
      return reply({ ok: true, ...data, message: `DRAFT-${draftId} rechazado. No se enviará.` });
    }
    return reply({ error: "action must be approve or reject" }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, 422);
  }
});
