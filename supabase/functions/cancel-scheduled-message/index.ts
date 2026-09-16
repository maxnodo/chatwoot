// Edge Function: cancel-scheduled-message (v1)
// Cancela un mensaje programado (status pending -> cancelled).
// Validaciones:
//   - account_id = 1
//   - scheduled_id existe Y pertenece a conversation_display_id pasada Y a account 1
//   - status actual = 'pending' (no se puede cancelar uno ya enviado o cancelado)
// Loggea cada attempt en nodo_schedule_message_attempts con operation='cancel'.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ACCOUNT_ID = 1;

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

async function logAttempt(
  supabase: SupabaseClient,
  headers: Record<string, string>,
  rawText: string,
  body: any,
  accountId: number,
  convDisplayId: number,
  scheduledId: number | null,
  status: number,
  err: string | null,
) {
  try {
    await supabase.from("nodo_schedule_message_attempts").insert({
      operation: "cancel",
      request_headers: headers,
      request_body_raw: rawText,
      request_body_parsed: body,
      parsed_account_id: Number.isFinite(accountId) ? accountId : null,
      parsed_conversation_display_id: Number.isFinite(convDisplayId) ? convDisplayId : null,
      parsed_content_length: 0,
      parsed_send_at_raw: null,
      response_status: status,
      response_error: err,
      scheduled_id: scheduledId,
    });
  } catch (e) {
    console.error("audit insert failed:", e);
  }
}

function fmtMadrid(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-AR", {
      timeZone: "Europe/Madrid",
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
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
    await logAttempt(supabase, dbgHeaders, rawText, null, NaN, NaN, null, 400, "Invalid JSON");
    return jsonResponse({ error: "Invalid JSON body", message: "Error: body invalido." }, 400);
  }

  const accountId = Number(req.headers.get("x-chatwoot-account-id") ?? body.account_id);
  const convDisplayId = Number(
    req.headers.get("x-chatwoot-conversation-display-id") ??
    req.headers.get("x-chatwoot-conversation-id") ??
    body.conversation_id
  );
  const scheduledId = Number(body.scheduled_id);

  if (accountId !== ALLOWED_ACCOUNT_ID) {
    const msg = `account_id ${accountId} no autorizado`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, null, 403, msg);
    return jsonResponse({ error: msg, message: "Error: account no autorizado." }, 403);
  }
  if (!Number.isInteger(convDisplayId) || convDisplayId < 1) {
    const msg = "conversation_id (display_id) requerido";
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, null, 400, msg);
    return jsonResponse({ error: msg, message: "Error: no recib conversation_id del contexto." }, 400);
  }
  if (!Number.isInteger(scheduledId) || scheduledId < 1) {
    const msg = "scheduled_id requerido y vlido (numero del folio SCHED-N)";
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, null, 400, msg);
    return jsonResponse({ error: msg, message: "Error: scheduled_id invalido. Esperaba el numero despues de SCHED-." }, 400);
  }

  // Buscar el mensaje y verificar pertenencia
  const { data: sched, error: schedErr } = await supabase
    .from("nodo_scheduled_messages")
    .select("id, account_id, conversation_display_id, status, content, send_at")
    .eq("id", scheduledId)
    .maybeSingle();

  if (schedErr) {
    const msg = `DB error: ${schedErr.message}`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, 500, msg);
    return jsonResponse({ error: msg, message: "Error consultando la base." }, 500);
  }
  if (!sched) {
    const msg = `SCHED-${scheduledId} no existe`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, 404, msg);
    return jsonResponse({
      error: msg,
      message: `No encontr ningn mensaje programado con folio SCHED-${scheduledId}. Quiz s ya fue borrado o el nmero est mal.`,
    }, 404);
  }
  if (sched.account_id !== accountId || sched.conversation_display_id !== convDisplayId) {
    const msg = `SCHED-${scheduledId} no pertenece a esta conversacion`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, 403, msg);
    return jsonResponse({
      error: msg,
      message: `El mensaje SCHED-${scheduledId} no pertenece a esta conversacion. No puedo cancelarlo desde aca.`,
    }, 403);
  }
  if (sched.status !== "pending") {
    const msg = `SCHED-${scheduledId} status=${sched.status}, no es cancelable`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, 409, msg);
    let userMsg: string;
    if (sched.status === "sent") userMsg = `El mensaje SCHED-${scheduledId} ya fue enviado, no se puede cancelar.`;
    else if (sched.status === "cancelled") userMsg = `El mensaje SCHED-${scheduledId} ya estaba cancelado.`;
    else if (sched.status === "failed") userMsg = `El mensaje SCHED-${scheduledId} fall  al enviar. No se puede cancelar (revis  los logs).`;
    else userMsg = `El mensaje SCHED-${scheduledId} esta en status '${sched.status}', no es cancelable.`;
    return jsonResponse({ error: msg, message: userMsg }, 409);
  }

  // Cancelar
  const { error: updErr } = await supabase
    .from("nodo_scheduled_messages")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", scheduledId)
    .eq("status", "pending"); // race-safe: si el cron lo agarra primero, no lo pisamos

  if (updErr) {
    const msg = `update fail: ${updErr.message}`;
    await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, 500, msg);
    return jsonResponse({ error: msg, message: "Error al cancelar el mensaje." }, 500);
  }

  await logAttempt(supabase, dbgHeaders, rawText, body, accountId, convDisplayId, scheduledId, 200, null);

  const sendAtMadrid = fmtMadrid(sched.send_at);
  return jsonResponse({
    ok: true,
    scheduled_id: scheduledId,
    new_status: "cancelled",
    message: `Cancelado: SCHED-${scheduledId} que iba a enviarse el ${sendAtMadrid} (Madrid). Contenido: "${(sched.content ?? "").slice(0, 80)}". Ya no se enviar.`,
  });
});

