// Edge Function: fetch-group-messages-test (DESCUBRIMIENTO - solo lectura)
// Prueba si Evolution guarda/devuelve el historial de mensajes de un grupo.
// NO envía nada. Solo consulta.
// Prueba el endpoint findMessages con filtro por el JID del grupo.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const EVOLUTION_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE") ?? "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (!EVOLUTION_URL || !EVOLUTION_INSTANCE || !EVOLUTION_API_KEY) {
    return jsonResponse({ error: "faltan secrets" }, 500);
  }

  let groupJid = "120363426324243049@g.us"; // Proyecto Comunicacion por defecto
  try {
    const body = JSON.parse(await req.text() || "{}");
    if (body.group_jid) groupJid = String(body.group_jid);
  } catch (_) { /* ignore */ }

  // Endpoint findMessages de Evolution (POST con where por remoteJid)
  const endpoint = `${EVOLUTION_URL}/chat/findMessages/${EVOLUTION_INSTANCE}`;

  let httpStatus = 0;
  let rawText = "";
  let parsed: unknown = null;
  let errorMsg: string | null = null;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": EVOLUTION_API_KEY },
      body: JSON.stringify({
        where: { key: { remoteJid: groupJid } },
        limit: 30,
      }),
    });
    httpStatus = res.status;
    rawText = await res.text();
    try { parsed = JSON.parse(rawText); } catch { parsed = rawText; }
  } catch (e) {
    errorMsg = String((e as Error)?.message ?? e);
  }

  // Intentar contar cuantos mensajes vinieron
  let count: number | null = null;
  let sample: unknown = null;
  if (parsed && typeof parsed === "object") {
    // Evolution suele devolver { messages: { records: [...], total } } o un array
    const p = parsed as Record<string, unknown>;
    const msgs = (p.messages as Record<string, unknown>)?.records ?? p.messages ?? (Array.isArray(parsed) ? parsed : null);
    if (Array.isArray(msgs)) {
      count = msgs.length;
      sample = msgs.slice(0, 2); // solo 2 de muestra para ver estructura
    }
  }

  return jsonResponse({
    ok: errorMsg === null && httpStatus >= 200 && httpStatus < 300,
    endpoint_used: endpoint,
    group_jid: groupJid,
    http_status: httpStatus,
    error: errorMsg,
    messages_count: count,
    sample_structure: sample,
    raw_preview: typeof rawText === "string" ? rawText.slice(0, 400) : null,
  });
});

