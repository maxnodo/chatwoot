// Edge Function: reschedule-scheduled-message (v1)
// Cambia send_at de un mensaje programado pending.
// Validaciones:
//   - account_id = 1
//   - scheduled_id pertenece a la conversation_display_id pasada
//   - status actual = 'pending'
//   - new_send_at entre 30s y 30d en el futuro
// Loggea attempt en nodo_schedule_message_attempts (operation='reschedule').

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ACCOUNT_ID = 1;
const MAX_FUTURE_DAYS = 30;
const MIN_FUTURE_SECONDS = 30;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-chatwoot-account-id, x-chatwoot-assistant-id, x-chatwoot-conversation-id, x-chatwoot-conversation-display-id, x-chatwoot-tool-slug, x-chatwoot-contact-id, x-chatwoot-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function parseIso(value: string): Date | null {
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch { return null; }
}

function fmtMadrid(iso: string | Date): string {
  try {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    return d.toLocaleString("es-AR", {
      timeZone: "Europe/Madrid",
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(iso); }
}

async function logAttempt(
  supabase: SupabaseClient,
  headers: Record<string, string>,
  rawText: string,
  body: any,
  accountId: number,
  convDisplayId: number,
  scheduledId: number | null,
  sendAtRaw: string,
  status: number,
  err: string | null,
) {
  try {
    await supabase.from("nodo_schedule_message_attempts").insert({
      operation: "reschedule",
      request_headers: headers,
      request_body_raw: rawText,
      request_body_parsed: body,
      parsed_account_id: Number.isFinite(accountId) ? accountId : null,
      parsed_conversation_display_id: Number.isFinite(convDisplayId) ? convDisplayId : null,
      parsed_content_length: 0,
      parsed_send_at_raw: sendAtRaw,
      response_status: status,
      response_error: err,
      scheduled_id: scheduledId,
    });
  } catch (e) {
    console.error("audit insert failed:", e);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const dbgHeaders: Record<string, string> = {};
  for (const h of ["x-chatwoot-account-id", "x-chatwoot-conversation-display-id", "x-chatwoot-conversation-id", "x-chatwoot-assistant-id", "x-chatwoot-tool-slug", "x-chatwoot-user-id", "content-type"]) {
    const v = req.headers.get(h);
    if (v) dbgHeaders[h] = v;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let rawText = "";
  let body: any = {};
  try {
    rawText = await req.text();
    if (rawText) body = JSON.parse(rawText);
  } catch {
    await logAttempt(supabase, dbgHeaders, rawText, null, NaN, NaN, null, "", 400, "Invalid JSON");
    return jsonResponse({ error: "Invalid JSON body", message: "Error: body invalido." }, 400);
  }

  const accountId = Number(req.headers.get("x-chatwoot-account-id") ?? body.account_id);
  const convDisplayId = Number(
    req.headers.get("x-chatwoot-conversation-display-id") ??
    req.headers.get("x-chatwoot-conversation-id") ??
    body.conversation_id
  );
  const scheduledId = Number(body.scheduled_id);
  const newSendAtRaw = typeof body.new_send_at === "string" ? body.new_send_at.trim() : "";

  if (accountId !== ALLOWED_ACCOUNT_ID) {
    const msg = `account_id ${accountId} no autorizado`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, null, newSendAtRaw, 403, msg);
    return jsonResponse({ error: msg, message: "Error: account no autorizado." }, 403);
  }
  if (!Number.isInteger(convDisplayId) || convDisplayId < 1) {
    const msg = "conversation_id requerido";
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, null, newSendAtRaw, 400, msg);
    return jsonResponse({ error: msg, message: "Error: no recib conversation_id del contexto." }, 400);
  }
  if (!Number.isInteger(scheduledId) || scheduledId < 1) {
    const msg = "scheduled_id requerido";
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, null, newSendAtRaw, 400, msg);
    return jsonResponse({ error: msg, message: "Error: scheduled_id invalido. Esperaba el numero despues de SCHED-." }, 400);
  }
  if (!newSendAtRaw) {
    const msg = "new_send_at requerido";
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 400, msg);
    return jsonResponse({ error: msg, message: "Error: falta new_send_at (ISO 8601 UTC)." }, 400);
  }

  const newSendAt = parseIso(newSendAtRaw);
  if (!newSendAt) {
    const msg = `new_send_at invalido: ${newSendAtRaw}`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 400, msg);
    return jsonResponse({ error: msg, message: "Error: new_send_at no es ISO 8601 valido (ej: 2026-05-13T10:00:00Z)." }, 400);
  }
  const now = new Date();
  const minFuture = new Date(now.getTime() + MIN_FUTURE_SECONDS * 1000);
  const maxFuture = new Date(now.getTime() + MAX_FUTURE_DAYS * 24 * 3600 * 1000);
  if (newSendAt < minFuture) {
    const msg = `new_send_at muy cercano: ${newSendAt.toISOString()}, ahora: ${now.toISOString()}`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 400, msg);
    return jsonResponse({ error: msg, message: `Error: la nueva fecha debe ser al menos 30 segundos en el futuro. Recibi ${fmtMadrid(newSendAt)} (Madrid) pero ahora son ${fmtMadrid(now)} (Madrid).` }, 400);
  }
  if (newSendAt > maxFuture) {
    const msg = `new_send_at fuera de rango (>30d)`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 400, msg);
    return jsonResponse({ error: msg, message: "Error: la nueva fecha debe estar dentro de los proximos 30 dias." }, 400);
  }

  // Verificar pertenencia + status
  const { data: sched, error: schedErr } = await supabase
    .from("nodo_scheduled_messages")
    .select("id, account_id, conversation_display_id, status, content, send_at")
    .eq("id", scheduledId)
    .maybeSingle();

  if (schedErr) {
    const msg = `DB err: ${schedErr.message}`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 500, msg);
    return jsonResponse({ error: msg, message: "Error consultando la base." }, 500);
  }
  if (!sched) {
    const msg = `SCHED-${scheduledId} no existe`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 404, msg);
    return jsonResponse({ error: msg, message: `No encontr el mensaje SCHED-${scheduledId}.` }, 404);
  }
  if (sched.account_id !== accountId || sched.conversation_display_id !== convDisplayId) {
    const msg = `SCHED-${scheduledId} no pertenece a esta conv`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 403, msg);
    return jsonResponse({ error: msg, message: `El mensaje SCHED-${scheduledId} no pertenece a esta conversacion.` }, 403);
  }
  if (sched.status !== "pending") {
    const msg = `SCHED-${scheduledId} status=${sched.status}, no se puede reprogramar`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 409, msg);
    let userMsg: string;
    if (sched.status === "sent") userMsg = `El mensaje SCHED-${scheduledId} ya fue enviado, no se puede reprogramar. Programe uno nuevo si necesita.`;
    else if (sched.status === "cancelled") userMsg = `El mensaje SCHED-${scheduledId} esta cancelado. Cree uno nuevo en lugar de reprogramarlo.`;
    else userMsg = `El mensaje SCHED-${scheduledId} esta en status '${sched.status}', no es reprogramable.`;
    return jsonResponse({ error: msg, message: userMsg }, 409);
  }

  const oldSendAtMadrid = fmtMadrid(sched.send_at);

  // UPDATE race-safe
  const { error: updErr } = await supabase
    .from("nodo_scheduled_messages")
    .update({ send_at: newSendAt.toISOString(), attempts: 0, updated_at: new Date().toISOString() })
    .eq("id", scheduledId)
    .eq("status", "pending");

  if (updErr) {
    const msg = `update fail: ${updErr.message}`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 500, msg);
    return jsonResponse({ error: msg, message: "Error al reprogramar el mensaje." }, 500);
  }

  await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, newSendAtRaw, 200, null);

  return jsonResponse({
    ok: true,
    scheduled_id: scheduledId,
    old_send_at_madrid: oldSendAtMadrid,
    new_send_at_iso: newSendAt.toISOString(),
    new_send_at_madrid: fmtMadrid(newSendAt),
    message: `Reprogramado: SCHED-${scheduledId} ahora se enviar el ${fmtMadrid(newSendAt)} (Madrid) en lugar del ${oldSendAtMadrid}. Contenido: "${(sched.content ?? "").slice(0, 80)}".`,
  });
});

