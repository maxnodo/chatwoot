import "jsr:@supabase/functions-js@2.115.0/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.115.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ACCOUNT_ID = 26;
const ASSISTANT_ID = 10;
const INBOX_ID = 43;
const LISTENING_TOOL_SLUG = "custom_consultar_escucha_activa";
const TOOL_SLUG = "custom_gestionar_boletines_coc";
const ACTIONS = ["create", "list", "update", "pause", "reactivate", "cancel"] as const;
type Action = (typeof ACTIONS)[number];

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-chatwoot-account-id, x-chatwoot-assistant-id, x-chatwoot-tool-slug, x-chatwoot-conversation-id, x-chatwoot-conversation-display-id, x-chatwoot-contact-id, x-chatwoot-contact-inbox-id, x-chatwoot-contact-inbox-verified",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers, "Content-Type": "application/json" },
});

const integerHeader = (request: Request, name: string) => {
  const value = request.headers.get(name) ?? "";
  return /^[1-9]\d{0,14}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
};

function madrid(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function scheduleSummary(schedule: Record<string, unknown>) {
  const frequency = schedule.frequency === "daily" ? "cada día" : `cada ${["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][Number(schedule.weekday)]}`;
  return `BOLETÍN-${schedule.id}: ${frequency} a las ${String(schedule.local_time).slice(0, 5)} (Madrid), tema ${schedule.topic}, período ${schedule.lookback_days === "1" ? "últimas 24 horas" : `últimos ${schedule.lookback_days} días`}, estado ${schedule.status}.`;
}

async function verifiedConversation(request: Request, db: SupabaseClient) {
  if (
    integerHeader(request, "x-chatwoot-account-id") !== ACCOUNT_ID ||
    integerHeader(request, "x-chatwoot-assistant-id") !== ASSISTANT_ID ||
    request.headers.get("x-chatwoot-tool-slug") !== TOOL_SLUG
  ) return null;

  const id = integerHeader(request, "x-chatwoot-conversation-id");
  const displayId = integerHeader(request, "x-chatwoot-conversation-display-id");
  const contactId = integerHeader(request, "x-chatwoot-contact-id");
  const contactInboxId = integerHeader(request, "x-chatwoot-contact-inbox-id");
  if (!id || !displayId || !contactId || !contactInboxId) return null;

  const { data: conversation } = await db.from("conversations")
    .select("id,display_id,account_id,inbox_id,contact_id,contact_inbox_id")
    .eq("id", id).eq("display_id", displayId).eq("account_id", ACCOUNT_ID).eq("inbox_id", INBOX_ID)
    .eq("contact_id", contactId).eq("contact_inbox_id", contactInboxId).maybeSingle();
  if (!conversation) return null;

  const { data: contactInbox } = await db.from("contact_inboxes")
    .select("id,contact_id,inbox_id,hmac_verified")
    .eq("id", contactInboxId).eq("contact_id", contactId).eq("inbox_id", INBOX_ID).maybeSingle();
  const { data: contact } = await db.from("contacts")
    .select("id,phone_number").eq("id", contactId).maybeSingle();
  const phone = String(contact?.phone_number ?? "").replace(/^\+/, "");
  if (!contactInbox || !/^\d{7,15}$/.test(phone)) return null;
  return { conversation, contactInbox };
}

async function integrationAuthorized(request: Request, db: SupabaseClient) {
  const auth = request.headers.get("authorization") ?? "";
  const { data: tool } = await db.from("captain_custom_tools")
    .select("auth_config, enabled")
    .eq("account_id", ACCOUNT_ID).eq("slug", LISTENING_TOOL_SLUG).maybeSingle();
  const token = tool?.auth_config?.token;
  return tool?.enabled === true && typeof token === "string" && auth === `Bearer ${token}`;
}

function parseAction(value: unknown): Action | null {
  const action = String(value ?? "").trim().toLowerCase();
  return (ACTIONS as readonly string[]).includes(action) ? action as Action : null;
}

function parseFrequency(value: unknown) {
  const frequency = String(value ?? "").trim().toLowerCase();
  return frequency === "daily" || frequency === "weekly" ? frequency : null;
}

function parseTime(value: unknown) {
  const time = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
}

function parseWeekday(value: unknown) {
  const weekday = Number(value);
  return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : null;
}

function parseLookback(value: unknown) {
  const lookback = String(value ?? "").trim();
  return ["1", "7", "30"].includes(lookback) ? lookback : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return reply({ error: "Invalid JSON" }, 400);
  const action = parseAction(body.action);
  if (!action) return reply({ error: "Invalid action" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await integrationAuthorized(request, db))) return reply({ error: "Unauthorized integration" }, 401);
  const context = await verifiedConversation(request, db);
  if (!context) return reply({
    ok: false,
    requires_verified_conversation: true,
    message: "Esta gestión solo está disponible dentro de una conversación de WhatsApp verificada de la bandeja COC. En Playground no se crea ni se consulta ninguna programación.",
  });

  const scope = { account_id: ACCOUNT_ID, conversation_id: context.conversation.id, contact_id: context.conversation.contact_id };
  if (action === "list") {
    const { data, error } = await db.from("nodo_coc_recurring_news_schedules").select("*")
      .match(scope).order("created_at", { ascending: false });
    if (error) return reply({ error: "Could not list schedules" }, 422);
    return reply({ ok: true, schedules: data ?? [], message: data?.length ? data.map(scheduleSummary).join("\n") : "No hay boletines recurrentes para este contacto." });
  }

  if (action === "create") {
    const frequency = parseFrequency(body.frequency);
    const localTime = parseTime(body.local_time);
    const weekday = frequency === "weekly" ? parseWeekday(body.weekday) : null;
    const topic = String(body.topic ?? "").trim();
    const lookback = parseLookback(body.lookback_days);
    if (!frequency || !localTime || !topic || topic.length > 500 || !lookback || (frequency === "weekly" && weekday === null)) {
      return reply({ error: "frequency, local_time, topic, lookback_days and weekday for weekly schedules are required" }, 400);
    }
    const { data: nextRun, error: nextError } = await db.rpc("nodo_next_coc_news_run", {
      p_frequency: frequency, p_weekday: weekday, p_local_time: localTime, p_after: new Date().toISOString(),
    });
    if (nextError) return reply({ error: "Could not calculate next delivery" }, 422);
    const { data: created, error } = await db.from("nodo_coc_recurring_news_schedules").insert({
      ...scope, assistant_id: ASSISTANT_ID, inbox_id: INBOX_ID, conversation_display_id: context.conversation.display_id,
      contact_inbox_id: context.contactInbox.id, frequency, weekday, local_time: localTime, topic, lookback_days: lookback,
      next_run_at: nextRun,
    }).select("*").single();
    if (error) return reply({ error: error.code === "23505" ? "Ya existe un boletín activo igual para este contacto." : "Could not save schedule" }, 422);
    await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: created.id, event_type: "created", payload: { action, verified_contact_id: context.conversation.contact_id } });
    return reply({ ok: true, schedule: created, message: `Boletín programado para este WhatsApp: ${scheduleSummary(created)} Próxima entrega: ${madrid(created.next_run_at)}.` });
  }

  const id = Number(body.schedule_id);
  if (!Number.isInteger(id) || id < 1) return reply({ error: "Valid schedule_id is required" }, 400);
  const { data: existing } = await db.from("nodo_coc_recurring_news_schedules").select("*")
    .match({ ...scope, id }).maybeSingle();
  if (!existing) return reply({ error: "Schedule not found for this contact" }, 404);

  if (action === "pause" || action === "cancel") {
    const status = action === "pause" ? "paused" : "cancelled";
    const { data: changed, error } = await db.from("nodo_coc_recurring_news_schedules").update({ status, updated_at: new Date().toISOString() })
      .eq("id", id).eq("status", "active").select("*").maybeSingle();
    if (error || !changed) return reply({ error: "Schedule cannot be changed" }, 422);
    await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: id, event_type: action === "pause" ? "paused" : "cancelled", payload: {} });
    return reply({ ok: true, schedule: changed, message: `${action === "pause" ? "Boletín pausado" : "Boletín cancelado"}. ${scheduleSummary(changed)}` });
  }

  const frequency = body.frequency == null ? existing.frequency : parseFrequency(body.frequency);
  const localTime = body.local_time == null ? String(existing.local_time).slice(0, 5) : parseTime(body.local_time);
  const weekday = frequency === "weekly" ? (body.weekday == null ? existing.weekday : parseWeekday(body.weekday)) : null;
  const topic = body.topic == null ? existing.topic : String(body.topic).trim();
  const lookback = body.lookback_days == null ? existing.lookback_days : parseLookback(body.lookback_days);
  if (!frequency || !localTime || !topic || topic.length > 500 || !lookback || (frequency === "weekly" && weekday === null)) {
    return reply({ error: "The requested update is incomplete or invalid" }, 400);
  }
  const { data: nextRun, error: nextError } = await db.rpc("nodo_next_coc_news_run", {
    p_frequency: frequency, p_weekday: weekday, p_local_time: localTime, p_after: new Date().toISOString(),
  });
  if (nextError) return reply({ error: "Could not calculate next delivery" }, 422);
  const status = action === "reactivate" ? "active" : existing.status;
  if (action === "reactivate" && existing.status !== "paused") return reply({ error: "Only paused schedules can be reactivated" }, 422);
  const { data: changed, error } = await db.from("nodo_coc_recurring_news_schedules").update({
    frequency, weekday, local_time: localTime, topic, lookback_days: lookback, status, next_run_at: nextRun, updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error) return reply({ error: "Could not update schedule" }, 422);
  await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: id, event_type: action === "reactivate" ? "reactivated" : "updated", payload: { action } });
  return reply({ ok: true, schedule: changed, message: `${action === "reactivate" ? "Boletín reactivado" : "Boletín actualizado"}. ${scheduleSummary(changed)} Próxima entrega: ${madrid(changed.next_run_at)}.` });
});
