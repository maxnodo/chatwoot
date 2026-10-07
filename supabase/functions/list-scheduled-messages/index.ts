// Edge Function: list-scheduled-messages (v1)
// Retorna los envíos únicos y las reglas recurrentes de una conversación
// (display_id) para que Captain Copilot pueda armar resúmenes completos.
//
// Input body:
//   { conversation_id: string, status_filter?: 'pending'|'sent'|'failed'|'cancelled'|'all', limit?: number|string }
//
// Restricciones:
//   - account_id debe pertenecer a una cuenta autorizada
//   - limit: default 20, max 50

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ALLOWED_ACCOUNT_IDS = [1, 25];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const VALID_STATUSES = ["pending", "sent", "failed", "cancelled"];

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-chatwoot-account-id, x-chatwoot-assistant-id, x-chatwoot-conversation-id, x-chatwoot-conversation-display-id, x-chatwoot-tool-slug, x-chatwoot-contact-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function fmtMadrid(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-AR", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const WEEKDAY_NAMES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: any = {};
  try {
    const txt = await req.text();
    if (txt) body = JSON.parse(txt);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const headerAccountId = req.headers.get("x-chatwoot-account-id");
  const headerConvDisplayId = req.headers.get(
    "x-chatwoot-conversation-display-id",
  );
  const headerConvId = req.headers.get("x-chatwoot-conversation-id");
  const accountId = Number(headerAccountId ?? body.account_id);
  const conversationDisplayId = Number(
    headerConvDisplayId ?? headerConvId ?? body.conversation_id,
  );

  let statusFilter = typeof body.status_filter === "string"
    ? body.status_filter.trim().toLowerCase()
    : "all";
  if (statusFilter === "") statusFilter = "all";
  if (statusFilter !== "all" && !VALID_STATUSES.includes(statusFilter)) {
    return jsonResponse({
      error: `status_filter inválido. Valores permitidos: ${
        VALID_STATUSES.join(", ")
      }, all`,
    }, 400);
  }

  let limit = Number(body.limit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  if (!ALLOWED_ACCOUNT_IDS.includes(accountId)) {
    return jsonResponse({
      error: `account_id ${accountId} no autorizado`,
      message: "Error: account no autorizado.",
    }, 403);
  }
  if (!Number.isInteger(conversationDisplayId) || conversationDisplayId < 1) {
    return jsonResponse({
      error: "conversation_id (display_id) requerido y válido",
      message: "Error: no recibí el conversation_id del contexto.",
    }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let q = supabase
    .from("nodo_scheduled_messages")
    .select(
      "id, send_at, status, content, sent_at, error_message, scheduled_via, created_at",
    )
    .eq("conversation_display_id", conversationDisplayId)
    .eq("account_id", accountId)
    .order("send_at", { ascending: true })
    .limit(limit);

  if (statusFilter !== "all") q = q.eq("status", statusFilter);

  const { data: rows, error: qErr } = await q;
  if (qErr) {
    return jsonResponse({
      error: "Error al consultar mensajes programados",
      detail: qErr.message,
      message: `Error al listar mensajes programados: ${qErr.message}`,
    }, 500);
  }

  const items = (rows ?? []).map((r: any) => ({
    scheduled_id: r.id,
    folio: `SCHED-${r.id}`,
    status: r.status,
    send_at_iso: r.send_at,
    send_at_madrid: fmtMadrid(r.send_at),
    sent_at_madrid: r.sent_at ? fmtMadrid(r.sent_at) : null,
    content_preview: (r.content ?? "").slice(0, 100),
    error_message: r.error_message,
    scheduled_via: r.scheduled_via,
  }));

  // Las reglas recurrentes no materializan un nodo_scheduled_messages hasta
  // que llega su próxima ejecución. Incluírlas aquí evita que Copilot afirme
  // erróneamente que una conversación no tiene programaciones.
  let recurringQuery = supabase
    .from("nodo_weekly_recurring_messages")
    .select(
      "id, content, weekday, local_time, timezone, status, next_run_at, last_materialized_at, created_at",
    )
    .eq("conversation_display_id", conversationDisplayId)
    .eq("account_id", accountId)
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (["all", "pending"].includes(statusFilter)) {
    recurringQuery = recurringQuery.eq("status", "active");
  }
  if (statusFilter === "cancelled") {
    recurringQuery = recurringQuery.eq("status", "cancelled");
  }
  if (["sent", "failed"].includes(statusFilter)) {
    recurringQuery = recurringQuery.eq("id", -1);
  }

  const { data: recurringRows, error: recurringErr } = await recurringQuery;
  if (recurringErr) {
    return jsonResponse({
      error: "Error al consultar reglas recurrentes",
      detail: recurringErr.message,
      message: `Error al listar reglas recurrentes: ${recurringErr.message}`,
    }, 500);
  }

  const recurringItems = (recurringRows ?? []).map((r: any) => ({
    recurring_id: r.id,
    folio: `REC-${r.id}`,
    status: r.status,
    weekday: r.weekday,
    weekday_name: WEEKDAY_NAMES[Number(r.weekday)] ?? `día ${r.weekday}`,
    local_time: String(r.local_time ?? "").slice(0, 5),
    timezone: r.timezone,
    next_run_at_iso: r.next_run_at,
    next_run_at_madrid: fmtMadrid(r.next_run_at),
    content_preview: (r.content ?? "").slice(0, 100),
  }));

  // Texto humano para el LLM (se extrae con response_template {{response.message}})
  let msg: string;
  if (items.length === 0 && recurringItems.length === 0) {
    msg = statusFilter === "all"
      ? `No hay envíos únicos ni reglas recurrentes para la conversación ${conversationDisplayId}.`
      : `No hay mensajes con status '${statusFilter}' para la conversación ${conversationDisplayId}.`;
  } else {
    const lines = items.map((it: any) => {
      const when = it.status === "sent" && it.sent_at_madrid
        ? `enviado ${it.sent_at_madrid}`
        : `programado ${it.send_at_madrid}`;
      const errBit = it.error_message ? ` | err: ${it.error_message}` : "";
      return `- ${it.folio} | envío único | ${it.status} | ${when} (Madrid) | "${it.content_preview}"${errBit}`;
    });
    lines.push(
      ...recurringItems.map((it: any) =>
        `- ${it.folio} | recurrente | ${it.status} | todos los ${it.weekday_name} a las ${it.local_time} (Madrid) | próxima ejecución ${it.next_run_at_madrid} | "${it.content_preview}"`
      ),
    );
    const header =
      `Encontré ${items.length} envío(s) único(s) y ${recurringItems.length} regla(s) recurrente(s) para la conversación ${conversationDisplayId}:`;
    msg = `${header}\n${lines.join("\n")}`;
  }

  return jsonResponse({
    ok: true,
    count: items.length,
    items,
    recurring_count: recurringItems.length,
    recurring_items: recurringItems,
    message: msg,
  });
});
