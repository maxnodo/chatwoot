import "jsr:@supabase/functions-js@2.115.0/edge-runtime.d.ts";
import { authorizeDispatch } from "../_shared/dispatch-auth.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.115.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CHATWOOT_BASE = "https://go.otronodo.com";
const ACCOUNT_ID = 26;
const ASSISTANT_ID = 10;
const INBOX_ID = 43;
const LISTENING_TOOL_SLUG = "custom_consultar_escucha_activa";
const MAX_PREPARATION_ATTEMPTS = 3;
const MAX_DELIVERY_ATTEMPTS = 3;

type ListeningTool = { endpoint_url: string; auth_config: { token?: string } };
type Run = { id: string; schedule_id: number; topic: string; lookback_days: string; conversation_id: number; conversation_display_id: number };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function getListeningTool(db: SupabaseClient): Promise<ListeningTool | null> {
  const { data } = await db.from("captain_custom_tools")
    .select("endpoint_url,auth_config,enabled,auth_type")
    .eq("account_id", ACCOUNT_ID).eq("slug", LISTENING_TOOL_SLUG).maybeSingle();
  if (!data?.enabled || data.auth_type !== "bearer" || typeof data.endpoint_url !== "string" || typeof data.auth_config?.token !== "string") return null;
  return data as ListeningTool;
}

async function getAdminToken(db: SupabaseClient) {
  const { data: admins } = await db.from("account_users").select("user_id").eq("account_id", ACCOUNT_ID).eq("role", 1);
  const ids = (admins ?? []).map((admin) => admin.user_id);
  if (!ids.length) return null;
  const { data } = await db.from("access_tokens").select("token")
    .eq("owner_type", "User").in("owner_id", ids).limit(1).maybeSingle();
  return data?.token ?? null;
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bulletin(run: Run, payload: Record<string, unknown>) {
  const analysis = cleanText(payload.text);
  const sources = Array.isArray(payload.sources) ? payload.sources.slice(0, 5) as Array<Record<string, unknown>> : [];
  const sourceLines = sources
    .filter((source) => /^https?:\/\//i.test(String(source.url ?? "")))
    .map((source) => `${cleanText(source.medium)} · ${cleanText(source.title)}\n${String(source.url)}`);
  const scope = payload.scope as Record<string, unknown> | undefined;
  const periodFrom = scope?.period_from ? new Date(String(scope.period_from)).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : null;
  const periodUntil = scope?.period_until ? new Date(String(scope.period_until)).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : null;
  const period = periodFrom && periodUntil ? `Período consultado: ${periodFrom} — ${periodUntil} (Madrid).` : `Período consultado: últimas ${run.lookback_days === "1" ? "24 horas" : `${run.lookback_days} días`}.`;
  const limit = cleanText(payload.limitations ?? "");
  const result = [
    `Boletín COC · ${run.topic}`,
    analysis || "No encontramos evidencia suficiente en el archivo para elaborar el boletín solicitado.",
    sourceLines.length ? `Fuentes originales:\n${sourceLines.join("\n\n")}` : "No hay enlaces originales disponibles para este período.",
    period,
    limit ? `Alcance y límites: ${limit.slice(0, 500)}` : "",
  ].filter(Boolean).join("\n\n");
  return result.length <= 3500 ? result : `${result.slice(0, 3470).trimEnd()}…`;
}

async function markPreparationFailure(db: SupabaseClient, run: Run, errorCode: string, message: string) {
  const attempts = await db.from("nodo_coc_recurring_news_runs").select("preparation_attempts").eq("id", run.id).single();
  const nextAttempts = (attempts.data?.preparation_attempts ?? 0) + 1;
  const final = nextAttempts >= MAX_PREPARATION_ATTEMPTS;
  await db.from("nodo_coc_recurring_news_runs").update({
    preparation_attempts: nextAttempts,
    status: final ? "failed" : "preparing",
    error_code: errorCode,
    error_message: message.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("id", run.id);
  if (final) await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: run.schedule_id, run_id: run.id, event_type: "failed", payload: { stage: "preparation", error_code: errorCode } });
}

async function startPreparation(db: SupabaseClient, tool: ListeningTool, run: Run) {
  const question = `Prepara un boletín breve institucional en español peninsular sobre ${run.topic}. Selecciona entre 3 y 5 noticias de política y asuntos públicos del período solicitado. Incluye solo evidencia del archivo, enlaces originales por noticia y limita claramente la cobertura. No uses citas numeradas.`;
  const response = await fetch(tool.endpoint_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tool.auth_config.token}`,
      "X-Chatwoot-Account-Id": String(ACCOUNT_ID),
      "X-Chatwoot-Assistant-Id": String(ASSISTANT_ID),
      "X-Chatwoot-Tool-Slug": LISTENING_TOOL_SLUG,
      "X-Chatwoot-Conversation-Id": String(run.conversation_id),
      "X-Chatwoot-Conversation-Display-Id": String(run.conversation_display_id),
    },
    body: JSON.stringify({ action: "ask", question, days: run.lookback_days }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return markPreparationFailure(db, run, "listening_request_failed", String(payload.error ?? response.status));
  if (payload.status === "completed") return savePrepared(db, run, payload);
  if (typeof payload.analysis_id !== "string") return markPreparationFailure(db, run, "analysis_id_missing", "La integración no devolvió un análisis identificable.");
  await db.from("nodo_coc_recurring_news_runs").update({
    status: "awaiting_analysis", analysis_id: payload.analysis_id, preparation_attempts: 1, updated_at: new Date().toISOString(),
  }).eq("id", run.id).eq("status", "preparing");
}

async function savePrepared(db: SupabaseClient, run: Run, payload: Record<string, unknown>) {
  const scope = payload.scope as Record<string, unknown> | undefined;
  const { error } = await db.from("nodo_coc_recurring_news_runs").update({
    status: "delivery_pending", prepared_at: new Date().toISOString(),
    coverage_from: scope?.period_from ?? null, coverage_until: scope?.period_until ?? new Date().toISOString(),
    message_content: bulletin(run, payload), next_attempt_at: new Date().toISOString(),
    error_code: null, error_message: null, updated_at: new Date().toISOString(),
  }).eq("id", run.id).in("status", ["preparing", "awaiting_analysis"]);
  if (!error) await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: run.schedule_id, run_id: run.id, event_type: "prepared", payload: { coverage_from: scope?.period_from ?? null, coverage_until: scope?.period_until ?? null } });
}

async function pollPreparations(db: SupabaseClient, tool: ListeningTool) {
  const { data: runs } = await db.from("nodo_coc_recurring_news_runs")
    .select("id,schedule_id,analysis_id,updated_at,nodo_coc_recurring_news_schedules!inner(topic,lookback_days,conversation_id,conversation_display_id)")
    .eq("status", "awaiting_analysis").lt("preparation_attempts", MAX_PREPARATION_ATTEMPTS).limit(20);
  for (const row of runs ?? []) {
    const schedule = row.nodo_coc_recurring_news_schedules as unknown as { topic: string; lookback_days: string; conversation_id: number; conversation_display_id: number };
    const run: Run = { id: row.id, schedule_id: row.schedule_id, topic: schedule.topic, lookback_days: schedule.lookback_days, conversation_id: schedule.conversation_id, conversation_display_id: schedule.conversation_display_id };
    const response = await fetch(tool.endpoint_url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tool.auth_config.token}` },
      body: JSON.stringify({ action: "analysis_status", analysis_id: row.analysis_id }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || payload.status === "failed") {
      await markPreparationFailure(db, run, "analysis_failed", String(payload.error ?? "El análisis no se completó."));
    } else if (payload.status === "completed") {
      await savePrepared(db, run, payload);
    } else if (new Date(row.updated_at).getTime() < Date.now() - 10 * 60_000) {
      await markPreparationFailure(db, run, "analysis_timeout", "El análisis no terminó dentro del tiempo esperado.");
    }
  }
}

async function deliverPrepared(db: SupabaseClient, token: string) {
  const { data: claims, error } = await db.rpc("nodo_claim_coc_news_deliveries");
  if (error) throw error;
  for (const claim of claims ?? []) {
    await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: claim.schedule_id, run_id: claim.run_id, event_type: "delivery_attempted", payload: { attempt: claim.attempt } });
    try {
      const { data: rawTarget } = await db.from("nodo_coc_recurring_news_schedules")
        .select("id,contact_inbox_id,conversations!inner(account_id,inbox_id),contact_inboxes!inner(hmac_verified)")
        .eq("id", claim.schedule_id).maybeSingle();
      const target = rawTarget as { conversations: { account_id: number; inbox_id: number }; contact_inboxes: { hmac_verified: boolean } } | null;
      if (!target || target.conversations.account_id !== ACCOUNT_ID || target.conversations.inbox_id !== INBOX_ID || !target.contact_inboxes.hmac_verified) {
        await db.from("nodo_coc_recurring_news_runs").update({ status: "failed", error_code: "recipient_not_verified", error_message: "La conversación o el contacto ya no cumplen las condiciones verificadas de entrega.", updated_at: new Date().toISOString() }).eq("id", claim.run_id).eq("status", "delivering");
        await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: claim.schedule_id, run_id: claim.run_id, event_type: "failed", payload: { stage: "delivery", error_code: "recipient_not_verified" } });
        continue;
      }
      const response = await fetch(`${CHATWOOT_BASE}/api/v1/accounts/${claim.account_id}/conversations/${claim.conversation_display_id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", api_access_token: token },
        body: JSON.stringify({ content: claim.content, message_type: "outgoing", private: false, content_attributes: { link_preview: false, linkPreview: false, recurring_news_run_id: claim.run_id } }),
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok) {
        await db.from("nodo_coc_recurring_news_runs").update({ status: "delivered", delivered_at: new Date().toISOString(), delivery_message_id: body.id ?? null, updated_at: new Date().toISOString() }).eq("id", claim.run_id).eq("status", "delivering");
        await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: claim.schedule_id, run_id: claim.run_id, event_type: "delivered", payload: { message_id: body.id ?? null } });
      } else {
        const retry = claim.attempt < MAX_DELIVERY_ATTEMPTS;
        await db.from("nodo_coc_recurring_news_runs").update({ status: retry ? "delivery_pending" : "failed", next_attempt_at: retry ? new Date(Date.now() + claim.attempt * 60_000).toISOString() : null, error_code: `chatwoot_http_${response.status}`, error_message: JSON.stringify(body).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", claim.run_id).eq("status", "delivering");
        if (!retry) await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: claim.schedule_id, run_id: claim.run_id, event_type: "failed", payload: { stage: "delivery", error_code: `chatwoot_http_${response.status}` } });
      }
    } catch (error) {
      await db.from("nodo_coc_recurring_news_runs").update({ status: "failed", error_code: "delivery_uncertain", error_message: `Entrega incierta; revisión manual requerida: ${String(error).slice(0, 400)}`, updated_at: new Date().toISOString() }).eq("id", claim.run_id).eq("status", "delivering");
      await db.from("nodo_coc_recurring_news_events").insert({ schedule_id: claim.schedule_id, run_id: claim.run_id, event_type: "failed", payload: { stage: "delivery", error_code: "delivery_uncertain" } });
    }
  }
}

Deno.serve(async (request) => {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const denied = await authorizeDispatch(request, db);
  if (denied) return denied;
  const tool = await getListeningTool(db);
  if (!tool) return json({ error: "COC listening integration unavailable" }, 503);
  const { data: due, error } = await db.rpc("nodo_claim_due_coc_news_runs");
  if (error) return json({ error: "Could not claim scheduled news" }, 500);
  for (const row of due ?? []) await startPreparation(db, tool, row as Run);
  await pollPreparations(db, tool);
  const token = await getAdminToken(db);
  if (!token) return json({ error: "CRM delivery credential unavailable" }, 503);
  await deliverPrepared(db, token);
  return json({ ok: true, prepared: due?.length ?? 0 });
});
