// Edge Function: dispatch-group-messages
// Lee mensajes pendientes de nodo_scheduled_group_messages cuyo send_at ya venció,
// y los envía a Evolution API directo al grupo (JID @g.us).
// NO pasa por Chatwoot. Dispara desde cron cada minuto.

import "jsr:@supabase/functions-js@2.115.0/edge-runtime.d.ts";
import { authorizeDispatch } from "../_shared/dispatch-auth.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.115.0";

const EVOLUTION_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE") ?? "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Cuántos mensajes procesa por corrida (evita ráfagas grandes)
const BATCH_SIZE = 5;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const denied = await authorizeDispatch(req, supabase);
  if (denied) return denied;
  if (!EVOLUTION_URL || !EVOLUTION_INSTANCE || !EVOLUTION_API_KEY) {
    return jsonResponse({ error: "faltan secrets de Evolution" }, 500);
  }

  // Traer pendientes vencidos
  const { data: pendientes, error: selErr } = await supabase
    .from("nodo_scheduled_group_messages")
    .select("id, group_jid, group_name, content, attempts")
    .eq("status", "pending")
    .lt("attempts", 3)
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (selErr) {
    return jsonResponse({ error: "error leyendo pendientes", detail: selErr.message }, 500);
  }
  if (!pendientes || pendientes.length === 0) {
    return jsonResponse({ ok: true, procesados: 0, mensaje: "sin pendientes" });
  }

  const resultados: Array<Record<string, unknown>> = [];

  for (const candidate of pendientes) {
    const { data: msg, error: claimError } = await supabase
      .from("nodo_scheduled_group_messages")
      .update({ status: "processing", attempts: (candidate.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq("id", candidate.id).eq("status", "pending")
      .lte("send_at", new Date().toISOString())
      .select("*").maybeSingle();
    if (claimError) return jsonResponse({ error: "claim failed" }, 500);
    if (!msg) continue;
    const endpoint = `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`;
    let ok = false;
    let errMsg: string | null = null;
    let httpStatus = 0;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          number: msg.group_jid, // el JID de grupo va en 'number'
          text: msg.content,
        }),
      });
      httpStatus = res.status;
      if (res.ok) {
        ok = true;
      } else {
        errMsg = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      }
    } catch (e) {
      errMsg = "Delivery uncertain; manual review required: " + String((e as Error)?.message ?? e);
    }

    // Actualizar estado
    if (ok) {
      await supabase
        .from("nodo_scheduled_group_messages")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: msg.attempts, updated_at: new Date().toISOString() })
        .eq("id", msg.id).eq("status", "processing").throwOnError();
    } else {
      // Si supera 3 intentos, marcar como error definitivo; si no, sigue pending para reintentar
      const nuevoAttempts = msg.attempts;
      const nuevoStatus = httpStatus === 0 || nuevoAttempts >= 3 ? "error" : "pending";
      await supabase
        .from("nodo_scheduled_group_messages")
        .update({ status: nuevoStatus, attempts: nuevoAttempts, error_message: errMsg, updated_at: new Date().toISOString() })
        .eq("id", msg.id).eq("status", "processing").throwOnError();
    }

    resultados.push({ id: msg.id, group: msg.group_name, ok, http_status: httpStatus, error: errMsg });
  }

  return jsonResponse({ ok: true, procesados: resultados.length, resultados });
});

