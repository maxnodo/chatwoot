import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ACCOUNT_IDS = [1, 25];
const VALID_ACTIONS = ["create", "list", "update", "pause", "resume", "cancel"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-chatwoot-account-id, x-chatwoot-conversation-display-id, x-chatwoot-conversation-id, x-chatwoot-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function madridDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ruleSummary(rule: Record<string, unknown>) {
  const weekdayNames = [
    "domingo",
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
  ];
  const weekday = weekdayNames[Number(rule.weekday)] ?? `día ${rule.weekday}`;
  const time = String(rule.local_time ?? "").slice(0, 5);
  return `REC-${rule.id}: ${weekday} a las ${time} (Madrid), estado ${rule.status}, próxima ejecución ${
    madridDate(String(rule.next_run_at))
  }.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return response({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action ?? "").trim().toLowerCase();
  const accountId = Number(
    req.headers.get("x-chatwoot-account-id") ?? body.account_id,
  );
  const conversationId = Number(
    req.headers.get("x-chatwoot-conversation-display-id") ??
      req.headers.get("x-chatwoot-conversation-id") ?? body.conversation_id,
  );
  const userIdRaw = req.headers.get("x-chatwoot-user-id");
  const userId = userIdRaw ? Number(userIdRaw) : null;

  if (!VALID_ACTIONS.includes(action)) {
    return response({ error: "Invalid action" }, 400);
  }
  if (!ALLOWED_ACCOUNT_IDS.includes(accountId)) {
    return response({ error: "Account not authorized" }, 403);
  }
  if (!Number.isInteger(conversationId) || conversationId < 1) {
    return response({ error: "Valid conversation_id is required" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (action === "create") {
      const content = String(body.content ?? "").trim();
      const weekday = Number(body.weekday);
      const localTime = String(body.local_time ?? "").trim();
      if (!content || content.length > 4000) {
        return response({ error: "Content is required" }, 400);
      }
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        return response({
          error: "weekday must be between 0 (Sunday) and 6 (Saturday)",
        }, 400);
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
        return response({ error: "local_time must use HH:MM" }, 400);
      }

      const { data, error } = await supabase.rpc(
        "nodo_create_weekly_recurring_message",
        {
          p_account_id: accountId,
          p_conversation_display_id: conversationId,
          p_content: content,
          p_weekday: weekday,
          p_local_time: localTime,
          p_timezone: "Europe/Madrid",
          p_user_id: Number.isFinite(userId) ? userId : null,
        },
      );
      if (error) throw error;
      return response({
        ok: true,
        rule: data,
        message: `Regla recurrente creada. ${ruleSummary(data)}`,
      });
    }

    if (action === "list") {
      const { data, error } = await supabase.rpc(
        "nodo_list_weekly_recurring_messages",
        {
          p_account_id: accountId,
          p_conversation_display_id: conversationId,
        },
      );
      if (error) throw error;
      const rules = Array.isArray(data) ? data : [];
      const message = rules.length
        ? rules.map(ruleSummary).join("\n")
        : `No hay reglas recurrentes para la conversación ${conversationId}.`;
      return response({ ok: true, count: rules.length, rules, message });
    }

    const recurringId = Number(body.recurring_id);
    if (!Number.isInteger(recurringId) || recurringId < 1) {
      return response({ error: "A valid recurring_id is required" }, 400);
    }

    if (action === "update") {
      const content = body.content == null || body.content === ""
        ? null
        : String(body.content).trim();
      const weekday = body.weekday == null || body.weekday === ""
        ? null
        : Number(body.weekday);
      const localTime = body.local_time == null || body.local_time === ""
        ? null
        : String(body.local_time).trim();
      if (
        weekday != null &&
        (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)
      ) {
        return response({ error: "weekday must be between 0 and 6" }, 400);
      }
      if (localTime != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
        return response({ error: "local_time must use HH:MM" }, 400);
      }
      if (content == null && weekday == null && localTime == null) {
        return response({ error: "At least one field must be changed" }, 400);
      }
      const { data, error } = await supabase.rpc(
        "nodo_update_weekly_recurring_message",
        {
          p_account_id: accountId,
          p_conversation_display_id: conversationId,
          p_recurring_id: recurringId,
          p_content: content,
          p_weekday: weekday,
          p_local_time: localTime,
        },
      );
      if (error) throw error;
      return response({
        ok: true,
        rule: data,
        message: `Regla actualizada. ${ruleSummary(data)}`,
      });
    }

    const status = action === "resume"
      ? "active"
      : action === "pause"
      ? "paused"
      : "cancelled";
    const { data, error } = await supabase.rpc(
      "nodo_set_weekly_recurring_status",
      {
        p_account_id: accountId,
        p_conversation_display_id: conversationId,
        p_recurring_id: recurringId,
        p_status: status,
      },
    );
    if (error) throw error;
    return response({
      ok: true,
      rule: data,
      message: `Regla ${
        action === "resume"
          ? "reanudada"
          : action === "pause"
          ? "pausada"
          : "cancelada"
      }. ${ruleSummary(data)}`,
    });
  } catch (error) {
    console.error("manage-recurring-messages", error);
    return response({
      error: error instanceof Error ? error.message : String(error),
      message: "No se pudo completar la operación recurrente.",
    }, 422);
  }
});
