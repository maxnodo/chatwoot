// Edge Function: dispatch-scheduled-messages (worker, v3)
//
// v3 (3 jun 2026): MULTI-TENANT. Procesa msgs de CUALQUIER account/inbox cuyo
//   inbox sea Channel::Api (Evolution). Quita los hardcodes ALLOWED_ACCOUNT_ID=1
//   y ALLOWED_INBOX_ID=17 que impedían que las campañas de account 20 (Mooi) se
//   despacharan.
//
//   Cambios concretos vs v2:
//   - El SELECT de pendings NO filtra por account_id ni inbox_id.
//   - Por cada msg pendings, valida vía SQL que su inbox sea Channel::Api;
//     si no, lo marca como failed con error_message claro.
//   - Por cada msg busca un admin de SU PROPIA account y usa SU access_token.
//   - El endpoint Chatwoot usa msg.account_id en el path, no un valor fijo.
//   - Si no encuentra admin/token en la account del msg, lo marca failed con
//     error claro (no rompe el worker para los demás).
//
// v2 (15 may 2026): Patch 6 — si el row tiene `attachment_url`, descarga
//   la imagen y la postea como multipart al endpoint de Chatwoot junto al
//   content. Sin attachment, se comporta igual que v1 (POST JSON con content).
//
// v1 (12 may 2026): primer dispatch, solo content de texto.
//
// Cron cada 60s (disparado por pg_cron) procesa pending con send_at <= NOW().
//   1. Autenticar cron y reservar pending -> processing de forma atómica
//   2. POST a Chatwoot Application API
//   3. status -> sent | failed (segun OK | error con maximo 3 attempts)

import "jsr:@supabase/functions-js@2.115.0/edge-runtime.d.ts";
import { authorizeDispatch } from "../_shared/dispatch-auth.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.115.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CHATWOOT_BASE = "https://go.otronodo.com";

const MAX_BATCH = 50;
const MAX_ATTEMPTS = 3;
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ATTACHMENT_FETCH_TIMEOUT_MS = 10_000;

// Cache de tokens por account para no consultar la DB en cada msg del batch.
type AdminToken = { token: string } | { error: string };
const tokenCache = new Map<number, AdminToken>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Resuelve un access_token de admin (role=1) en la account indicada.
// Cachea para evitar 1 query por msg en el mismo tick.
async function getAdminTokenForAccount(
  supabase: SupabaseClient,
  accountId: number,
): Promise<AdminToken> {
  const cached = tokenCache.get(accountId);
  if (cached) return cached;

  const { data: admins } = await supabase
    .from("account_users")
    .select("user_id")
    .eq("account_id", accountId)
    .eq("role", 1);
  const adminIds = (admins ?? []).map((a) => a.user_id);
  if (adminIds.length === 0) {
    const v: AdminToken = { error: `no admin in account ${accountId}` };
    tokenCache.set(accountId, v);
    return v;
  }
  const { data: tokenRow } = await supabase
    .from("access_tokens")
    .select("token")
    .eq("owner_type", "User").in("owner_id", adminIds).limit(1).maybeSingle();
  if (!tokenRow) {
    const v: AdminToken = { error: `no admin access_token in account ${accountId}` };
    tokenCache.set(accountId, v);
    return v;
  }
  const v: AdminToken = { token: tokenRow.token as string };
  tokenCache.set(accountId, v);
  return v;
}

// Descarga la imagen desde la URL publica con timeout. Devuelve Blob o error.
async function downloadAttachment(url: string): Promise<{ blob: Blob; filename: string; contentType: string } | { error: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ATTACHMENT_FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) return { error: `fetch ${res.status}` };

    const lenHeader = res.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > ATTACHMENT_MAX_BYTES) {
      return { error: `attachment too large: ${lenHeader} bytes (max ${ATTACHMENT_MAX_BYTES})` };
    }

    const ab = await res.arrayBuffer();
    if (ab.byteLength > ATTACHMENT_MAX_BYTES) {
      return { error: `attachment too large after download: ${ab.byteLength} bytes` };
    }

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const blob = new Blob([ab], { type: contentType });
    let filename = "attachment";
    try {
      const u = new URL(url);
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        const last = segments[segments.length - 1];
        if (last.match(/\.[a-z0-9]{2,5}$/i)) filename = last;
      }
    } catch { /* keep default */ }
    if (filename === "attachment") {
      const ext = contentType.split("/")[1] || "bin";
      filename = `attachment.${ext}`;
    }
    return { blob, filename, contentType };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

async function cwSendMessageJson(accountId: number, displayId: number, content: string, token: string) {
  const path = `${CHATWOOT_BASE}/api/v1/accounts/${accountId}/conversations/${displayId}/messages`;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", api_access_token: token },
    body: JSON.stringify({ content, message_type: "outgoing", private: false }),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text };
}

async function cwSendMessageMultipart(
  accountId: number,
  displayId: number,
  content: string,
  attachmentBlob: Blob,
  filename: string,
  token: string,
) {
  const path = `${CHATWOOT_BASE}/api/v1/accounts/${accountId}/conversations/${displayId}/messages`;
  const form = new FormData();
  if (content && content.length > 0) form.append("content", content);
  form.append("message_type", "outgoing");
  form.append("private", "false");
  form.append("attachments[]", attachmentBlob, filename);

  const res = await fetch(path, {
    method: "POST",
    headers: { api_access_token: token },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text };
}

Deno.serve(async (req: Request): Promise<Response> => {

  const startedAt = new Date();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const denied = await authorizeDispatch(req, supabase);
  if (denied) return denied;

  // 1. Levantar pendings vencidos (multi-tenant: SIN filtro por account/inbox)
  const { data: pendings, error: selErr } = await supabase
    .from("nodo_scheduled_messages")
    .select("*")
    .eq("status", "pending")
    .lte("send_at", startedAt.toISOString())
    .lt("attempts", MAX_ATTEMPTS)
    .order("send_at", { ascending: true })
    .limit(MAX_BATCH);

  if (selErr) return jsonResponse({ error: "select failed", detail: selErr.message }, 500);
  if (!pendings || pendings.length === 0) {
    return jsonResponse({ ok: true, processed: 0, started_at: startedAt.toISOString() });
  }

  const results: Array<{ id: number; account_id: number; status: string; error?: string; method?: string }> = [];

  for (const candidate of pendings) {
    // Compare-and-set: a concurrent worker or cancellation can win only once.
    const { data: msg, error: claimError } = await supabase
      .from("nodo_scheduled_messages")
      .update({ status: "processing", attempts: candidate.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", candidate.id).eq("status", "pending").eq("attempts", candidate.attempts)
      .lte("send_at", new Date().toISOString())
      .select("*").maybeSingle();
    if (claimError) return jsonResponse({ error: "claim failed" }, 500);
    if (!msg) continue;
    const { data: inbox } = await supabase
      .from("inboxes")
      .select("id, channel_type, account_id")
      .eq("id", msg.inbox_id)
      .maybeSingle();

    if (!inbox) {
      await supabase.from("nodo_scheduled_messages").update({
        status: "failed",
        error_message: `inbox ${msg.inbox_id} no existe`,
        updated_at: new Date().toISOString(),
        attempts: msg.attempts,
      }).eq("id", msg.id).eq("status", "processing").throwOnError();
      results.push({ id: msg.id, account_id: msg.account_id, status: "failed", error: "inbox no existe" });
      continue;
    }

    if (inbox.channel_type !== "Channel::Api" || inbox.account_id !== msg.account_id) {
      await supabase.from("nodo_scheduled_messages").update({
        status: "failed",
        error_message: `inbox channel_type ${inbox.channel_type} no soportado por este dispatcher (solo Channel::Api)`,
        updated_at: new Date().toISOString(),
        attempts: msg.attempts,
      }).eq("id", msg.id).eq("status", "processing").throwOnError();
      results.push({ id: msg.id, account_id: msg.account_id, status: "failed", error: "channel no soportado" });
      continue;
    }

    const tk = await getAdminTokenForAccount(supabase, msg.account_id);
    if ("error" in tk) {
      await supabase.from("nodo_scheduled_messages").update({
        status: "failed",
        error_message: tk.error,
        updated_at: new Date().toISOString(),
        attempts: msg.attempts,
      }).eq("id", msg.id).eq("status", "processing").throwOnError();
      results.push({ id: msg.id, account_id: msg.account_id, status: "failed", error: tk.error });
      continue;
    }
    const token = tk.token;

    const { data: conv } = await supabase
      .from("conversations")
      .select("id, display_id, status, account_id, inbox_id")
      .eq("id", msg.conversation_id)
      .maybeSingle();

    if (!conv || conv.account_id !== msg.account_id || conv.inbox_id !== msg.inbox_id) {
      await supabase.from("nodo_scheduled_messages").update({
        status: "failed",
        error_message: "conversation no existe",
        updated_at: new Date().toISOString(),
        attempts: msg.attempts,
      }).eq("id", msg.id).eq("status", "processing").throwOnError();
      results.push({ id: msg.id, account_id: msg.account_id, status: "failed", error: "conversation no existe" });
      continue;
    }

    const displayId = conv.display_id ?? msg.conversation_display_id;
    if (!displayId) {
      await supabase.from("nodo_scheduled_messages").update({
        status: "failed",
        error_message: "display_id desconocido",
        updated_at: new Date().toISOString(),
        attempts: msg.attempts,
      }).eq("id", msg.id).eq("status", "processing").throwOnError();
      results.push({ id: msg.id, account_id: msg.account_id, status: "failed", error: "display_id desconocido" });
      continue;
    }

    try {
      let send;
      let method = "json";

      if (msg.attachment_url && typeof msg.attachment_url === "string" && msg.attachment_url.match(/^https:\/\//i)) {
        const dl = await downloadAttachment(msg.attachment_url);
        if ("error" in dl) {
          console.warn(`[dispatch] ${msg.id} attachment download failed (${dl.error}), falling back to text`);
          send = await cwSendMessageJson(msg.account_id, displayId, msg.content, token);
          method = "json-fallback-after-attachment-error";
        } else {
          send = await cwSendMessageMultipart(msg.account_id, displayId, msg.content, dl.blob, dl.filename, token);
          method = "multipart";
        }
      } else {
        send = await cwSendMessageJson(msg.account_id, displayId, msg.content, token);
      }

      if (send.ok) {
        await supabase.from("nodo_scheduled_messages").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts: msg.attempts,
          updated_at: new Date().toISOString(),
        }).eq("id", msg.id).eq("status", "processing").throwOnError();
        results.push({ id: msg.id, account_id: msg.account_id, status: "sent", method });
      } else {
        const newAttempts = msg.attempts;
        const finalStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
        await supabase.from("nodo_scheduled_messages").update({
          status: finalStatus,
          error_message: `HTTP ${send.status}: ${String(send.body).slice(0, 500)}`,
          attempts: newAttempts,
          updated_at: new Date().toISOString(),
        }).eq("id", msg.id).eq("status", "processing").throwOnError();
        results.push({ id: msg.id, account_id: msg.account_id, status: finalStatus, error: `HTTP ${send.status}`, method });
      }
    } catch (e) {
      const newAttempts = msg.attempts;
      // A transport/write failure may follow a successful delivery. Never retry blindly.
      const finalStatus = "failed";
      await supabase.from("nodo_scheduled_messages").update({
        status: finalStatus,
        error_message: ("Delivery uncertain; manual review required: " + String((e as Error)?.message ?? e)).slice(0, 500),
        attempts: newAttempts,
        updated_at: new Date().toISOString(),
      }).eq("id", msg.id).eq("status", "processing").throwOnError();
      results.push({ id: msg.id, account_id: msg.account_id, status: finalStatus, error: String(e) });
    }
  }

  return jsonResponse({
    ok: true,
    started_at: startedAt.toISOString(),
    processed: results.length,
    results,
  });
});

