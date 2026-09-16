// Edge Function: schedule-message (v8)
// v8 (18 may 2026): NODO PATCH — tolerancia a control characters en JSON body.
//   El LLM (Captain Copilot) a veces construye JSON con saltos de línea
//   LITERALES dentro de strings (en lugar de \\n escapados). Eso falla el
//   JSON.parse estándar. Ahora sanitizamos el body crudo automáticamente
//   antes de fallar — escapamos \n, \r, \t y otros control chars (0x00-0x1f)
//   que estén DENTRO de strings JSON. Loguamos en metadata si se usó el fix.
//   No afecta requests bien formados (sanitize solo corre si el primer parse falla).
//
// v7 (15 may 2026): Patch 6 — soporta attachment_url + campaign_id.
// v6: audit en nodo_schedule_message_attempts.
// v5: echo de `received` en errores.
// v4: busca por display_id en vez de id interno.
//
// Restricciones:
//   - account_id debe ser 1
//   - inbox.channel_type debe estar en Channel::Api
//   - send_at: 30s a 30d en el futuro
//   - content: 1-4000 chars
//   - attachment_url (opcional): debe empezar con https://
//   - campaign_id (opcional): entero positivo

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ALLOWED_ACCOUNT_ID = 1;
const ALLOWED_CHANNEL_TYPES = ["Channel::Api"];
const MAX_FUTURE_DAYS = 30;
const MIN_FUTURE_SECONDS = 30;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-chatwoot-account-id, x-chatwoot-assistant-id, x-chatwoot-conversation-id, x-chatwoot-conversation-display-id, x-chatwoot-tool-slug, x-chatwoot-contact-id, x-chatwoot-contact-email, x-chatwoot-contact-phone, x-chatwoot-contact-inbox-id, x-chatwoot-contact-inbox-verified, x-chatwoot-user-id",
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
  } catch {
    return null;
  }
}

function validateAttachmentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.match(/^https:\/\//i)) return null;
  if (trimmed.length > 2000) return null;
  return trimmed;
}

function validateCampaignId(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

// NODO v8: sanitiza control chars (\n, \r, \t, 0x00-0x1f) DENTRO de strings JSON.
// Pensado para reparar bodies que el LLM construyó con newlines literales en
// lugar de \\n escapados. Recorre el input carácter por carácter, sabiendo si
// está dentro o fuera de un string (entre comillas dobles no escapadas).
// Si el JSON original no tiene control chars dentro de strings, devuelve el
// mismo input sin cambios.
function sanitizeJsonControlChars(input: string): string {
  let out = "";
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (escapeNext) { out += c; escapeNext = false; continue; }
    if (c === "\\") { out += c; escapeNext = true; continue; }
    if (c === '"') { inString = !inString; out += c; continue; }
    if (inString) {
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        out += "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
    }
    out += c;
  }
  return out;
}

interface AuditSnapshot {
  request_headers: Record<string, string>;
  request_body_raw: string;
  request_body_parsed: any;
  parsed_account_id: number | null;
  parsed_conversation_display_id: number | null;
  parsed_content_length: number;
  parsed_send_at_raw: string;
}

async function logAttempt(
  supabase: SupabaseClient,
  snapshot: AuditSnapshot,
  responseStatus: number,
  responseError: string | null,
  scheduledId: number | null,
) {
  try {
    await supabase.from("nodo_schedule_message_attempts").insert({
      request_headers: snapshot.request_headers,
      request_body_raw: snapshot.request_body_raw,
      request_body_parsed: snapshot.request_body_parsed,
      parsed_account_id: snapshot.parsed_account_id,
      parsed_conversation_display_id: snapshot.parsed_conversation_display_id,
      parsed_content_length: snapshot.parsed_content_length,
      parsed_send_at_raw: snapshot.parsed_send_at_raw,
      response_status: responseStatus,
      response_error: responseError,
      scheduled_id: scheduledId,
    });
  } catch (e) {
    console.error("audit insert failed:", e);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const dbgHeaders: Record<string, string> = {};
  for (const h of [
    "x-chatwoot-account-id",
    "x-chatwoot-conversation-id",
    "x-chatwoot-conversation-display-id",
    "x-chatwoot-assistant-id",
    "x-chatwoot-tool-slug",
    "x-chatwoot-contact-id",
    "content-type",
    "user-agent",
  ]) {
    const v = req.headers.get(h);
    if (v) dbgHeaders[h] = v;
  }

  let rawText = "";
  let body: any = {};
  let sanitizeApplied = false;
  try {
    rawText = await req.text();
    if (rawText) {
      try {
        body = JSON.parse(rawText);
      } catch (firstErr) {
        // NODO v8: reintento con sanitize antes de fallar definitivamente.
        const sanitized = sanitizeJsonControlChars(rawText);
        if (sanitized !== rawText) {
          body = JSON.parse(sanitized);  // puede fallar de nuevo -> catch externo
          sanitizeApplied = true;
          console.log("[v8] sanitize applied: control chars escaped in JSON strings");
        } else {
          throw firstErr;  // no había nada que sanitizar, error real
        }
      }
    }
  } catch (_e) {
    const snap: AuditSnapshot = {
      request_headers: dbgHeaders, request_body_raw: rawText, request_body_parsed: null,
      parsed_account_id: null, parsed_conversation_display_id: null,
      parsed_content_length: 0, parsed_send_at_raw: "",
    };
    await logAttempt(supabase, snap, 400, "Invalid JSON body (sanitize did not help)", null);
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const headerAccountId = req.headers.get("x-chatwoot-account-id");
  const headerConvDisplayId = req.headers.get("x-chatwoot-conversation-display-id");
  const headerConvId = req.headers.get("x-chatwoot-conversation-id");
  const accountId = Number(headerAccountId ?? body.account_id);
  const conversationDisplayId = Number(
    headerConvDisplayId ?? headerConvId ?? body.conversation_id
  );

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const sendAtRaw = typeof body.send_at === "string" ? body.send_at.trim() : "";
  const userIdHeader = req.headers.get("x-chatwoot-user-id");
  const userId = userIdHeader ? Number(userIdHeader) : null;

  const attachmentUrl = validateAttachmentUrl(body.attachment_url);
  const campaignId = validateCampaignId(body.campaign_id);
  const scheduledVia = typeof body.scheduled_via === "string" && body.scheduled_via.length <= 50
    ? body.scheduled_via
    : (req.headers.get("x-chatwoot-assistant-id") ? "copilot" : "api_direct");

  const snap: AuditSnapshot = {
    request_headers: dbgHeaders,
    request_body_raw: rawText,
    request_body_parsed: body,
    parsed_account_id: Number.isFinite(accountId) ? accountId : null,
    parsed_conversation_display_id: Number.isFinite(conversationDisplayId) ? conversationDisplayId : null,
    parsed_content_length: content.length,
    parsed_send_at_raw: sendAtRaw,
  };

  if (accountId !== ALLOWED_ACCOUNT_ID) {
    const msg = `account_id ${accountId} no autorizado. Solo se permite ${ALLOWED_ACCOUNT_ID}.`;
    await logAttempt(supabase, snap, 403, msg, null);
    return jsonResponse({ error: msg }, 403);
  }
  if (!Number.isInteger(conversationDisplayId) || conversationDisplayId < 1) {
    const msg = "conversation_id (display_id) requerido y válido";
    await logAttempt(supabase, snap, 400, msg, null);
    return jsonResponse({ error: msg }, 400);
  }
  if (!content || content.length < 1 || content.length > 4000) {
    const msg = "content requerido (1-4000 caracteres)";
    await logAttempt(supabase, snap, 400, msg, null);
    return jsonResponse({ error: msg }, 400);
  }
  if (!sendAtRaw) {
    const msg = "send_at requerido (formato ISO 8601, ej: 2026-05-13T10:00:00Z)";
    await logAttempt(supabase, snap, 400, msg, null);
    return jsonResponse({ error: msg }, 400);
  }
  const sendAt = parseIso(sendAtRaw);
  if (!sendAt) {
    const msg = "send_at inválido. Usar ISO 8601 (ej: 2026-05-13T10:00:00Z)";
    await logAttempt(supabase, snap, 400, msg, null);
    return jsonResponse({ error: msg }, 400);
  }
  const now = new Date();
  const minFuture = new Date(now.getTime() + MIN_FUTURE_SECONDS * 1000);
  const maxFuture = new Date(now.getTime() + MAX_FUTURE_DAYS * 24 * 3600 * 1000);
  if (sendAt < minFuture) {
    const msg = `send_at debe ser al menos ${MIN_FUTURE_SECONDS}s en el futuro. Recibido: ${sendAt.toISOString()}, ahora: ${now.toISOString()}`;
    await logAttempt(supabase, snap, 400, msg, null);
    return jsonResponse({ error: msg }, 400);
  }
  if (sendAt > maxFuture) {
    const msg = `send_at debe ser dentro de los próximos ${MAX_FUTURE_DAYS} días`;
    await logAttempt(supabase, snap, 400, msg, null);
    return jsonResponse({ error: msg }, 400);
  }

  if (body.attachment_url && !attachmentUrl) {
    const msg = "attachment_url invalido: debe ser https://... (max 2000 chars)";
    await logAttempt(supabase, snap, 400, msg, null);
    return jsonResponse({ error: msg }, 400);
  }

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, display_id, account_id, inbox_id, status, contact_id")
    .eq("display_id", conversationDisplayId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (convErr) {
    const msg = `Error al verificar conversación: ${convErr.message}`;
    await logAttempt(supabase, snap, 500, msg, null);
    return jsonResponse({ error: "Error al verificar conversación", detail: convErr.message }, 500);
  }
  if (!conv) {
    const msg = `Conversación display_id=${conversationDisplayId} no existe en account ${accountId}`;
    await logAttempt(supabase, snap, 404, msg, null);
    return jsonResponse({ error: msg }, 404);
  }

  const { data: inbox, error: inboxErr } = await supabase
    .from("inboxes")
    .select("id, name, channel_type")
    .eq("id", conv.inbox_id)
    .maybeSingle();

  if (inboxErr || !inbox) {
    const msg = `Error al verificar inbox: ${inboxErr?.message ?? "no encontrado"}`;
    await logAttempt(supabase, snap, 500, msg, null);
    return jsonResponse({ error: "Error al verificar inbox de la conversación", detail: inboxErr?.message }, 500);
  }

  if (!ALLOWED_CHANNEL_TYPES.includes(inbox.channel_type)) {
    const msg = `Canal no permitido: inbox="${inbox.name}" type=${inbox.channel_type}`;
    await logAttempt(supabase, snap, 403, msg, null);
    return jsonResponse({
      error: "Esta conversación no se puede usar para programar mensajes.",
      detail: `La conversación está en el inbox "${inbox.name}" (tipo ${inbox.channel_type}). El feature schedule-message solo funciona con canales Channel::Api (Evolution).`,
      allowed_channel_types: ALLOWED_CHANNEL_TYPES,
      current_channel_type: inbox.channel_type,
    }, 403);
  }

  const insertPayload: Record<string, unknown> = {
    account_id: accountId,
    inbox_id: conv.inbox_id,
    conversation_id: conv.id,
    conversation_display_id: conv.display_id,
    content,
    send_at: sendAt.toISOString(),
    status: "pending",
    scheduled_by_user_id: userId,
    scheduled_via: scheduledVia,
    metadata: {
      contact_id: conv.contact_id,
      request_origin: req.headers.get("x-chatwoot-assistant-id") ? "captain_copilot" : "api_direct",
      channel_type: inbox.channel_type,
      inbox_name: inbox.name,
      has_attachment: !!attachmentUrl,
      campaign_id: campaignId,
      json_sanitize_applied: sanitizeApplied,
    },
  };
  if (attachmentUrl) insertPayload.attachment_url = attachmentUrl;
  if (campaignId !== null) insertPayload.campaign_id = campaignId;

  const { data: inserted, error: insErr } = await supabase
    .from("nodo_scheduled_messages")
    .insert(insertPayload)
    .select()
    .single();

  if (insErr || !inserted) {
    const msg = `Insert fail: ${insErr?.message ?? "unknown"}`;
    await logAttempt(supabase, snap, 500, msg, null);
    return jsonResponse({ error: "Error al guardar el mensaje programado", detail: insErr?.message }, 500);
  }

  await logAttempt(supabase, snap, 200, sanitizeApplied ? "sanitize applied" : null, inserted.id);

  const sendAtHuman = sendAt.toLocaleString("es-AR", {
    timeZone: "Europe/Madrid",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return jsonResponse({
    ok: true,
    scheduled_id: inserted.id,
    send_at: sendAt.toISOString(),
    send_at_human_madrid: sendAtHuman,
    conversation_display_id: conv.display_id,
    channel: inbox.channel_type,
    inbox: inbox.name,
    has_attachment: !!attachmentUrl,
    campaign_id: campaignId,
    json_sanitize_applied: sanitizeApplied,
    message: `Mensaje programado correctamente con ID ${inserted.id}, se enviará el ${sendAtHuman} (Madrid) via ${inbox.name}. Folio interno: SCHED-${inserted.id}.`,
  });
});

