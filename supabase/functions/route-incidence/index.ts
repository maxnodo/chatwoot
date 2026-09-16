// Edge Function: route-incidence v4
// v4: tolerante a params vacios/missing (fallback a defaults), logs explicitos.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CHATWOOT_BASE = "https://go.otronodo.com";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-chatwoot-account-id, x-chatwoot-assistant-id, x-chatwoot-conversation-id, x-chatwoot-conversation-display-id, x-chatwoot-tool-slug, x-chatwoot-contact-id, x-chatwoot-contact-email, x-chatwoot-contact-phone, x-chatwoot-contact-inbox-id, x-chatwoot-contact-inbox-verified",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIPO_TO_TEAM: Record<string, string> = {
  bache: "Vialidad",
  semaforo: "Vialidad",
  luminaria: "Alumbrado",
  basura: "Limpieza Urbana",
  arbol: "Espacios Verdes",
  pintada: "Mantenimiento",
  otro: "Coordinación",
};
const VALID_TIPOS = new Set(Object.keys(TIPO_TO_TEAM));

const PRIORITY_MAP: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
const PRIORITY_NAME: Record<number, string> = { 4: "urgent", 3: "high", 2: "medium", 1: "low" };

function inferPriority(tipo: string, descripcion: string): number {
  const desc = (descripcion || "").toLowerCase();
  if (/urgente|peligro|peligroso|cable suelto|cable colgando|fuego|inundaci|gas|herido/i.test(desc)) {
    return PRIORITY_MAP.urgent;
  }
  if (tipo === "arbol" && /cay|caido|caida|caíd/i.test(desc)) return PRIORITY_MAP.urgent;
  if (tipo === "semaforo") return PRIORITY_MAP.high;
  if (tipo === "bache" && /profund|grande|enorme|moto/i.test(desc)) return PRIORITY_MAP.high;
  if (tipo === "arbol") return PRIORITY_MAP.high;
  if (tipo === "luminaria" || tipo === "basura" || tipo === "bache") return PRIORITY_MAP.medium;
  if (tipo === "pintada") return PRIORITY_MAP.low;
  return PRIORITY_MAP.medium;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// Normaliza string: si viene null/undefined/empty/whitespace devuelve fallback
function sanitize(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s.length === 0 ? fallback : s;
}

type CwInit = { method?: string; body?: unknown; token: string };
async function cw<T = unknown>(path: string, init: CwInit): Promise<{ status: number; ok: boolean; body: T | unknown }> {
  const res = await fetch(`${CHATWOOT_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", api_access_token: init.token },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, ok: res.ok, body: parsed };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: any = {};
  try {
    const txt = await req.text();
    if (txt) body = JSON.parse(txt);
  } catch (err) {
    console.warn("Invalid JSON body, continuing with headers only:", err);
    body = {};
  }

  // Resolver account/conversation: priorizar headers de Chatwoot, fallback a body
  const headerAccountId = req.headers.get("x-chatwoot-account-id");
  const headerConvId = req.headers.get("x-chatwoot-conversation-id");
  const headerConvDisplayId = req.headers.get("x-chatwoot-conversation-display-id");
  const accountId = Number(headerAccountId ?? body.account_id);
  const conversationId = Number(headerConvId ?? body.conversation_id);
  const conversationDisplayIdHint = headerConvDisplayId ? Number(headerConvDisplayId) : null;

  // Sanitize todos los params, aplicando fallbacks defensivos
  let tipo = sanitize(body.tipo, "otro").toLowerCase();
  if (!VALID_TIPOS.has(tipo)) tipo = "otro";
  const ubicacion = sanitize(body.ubicacion, "no proporcionada");
  const descripcion = sanitize(body.descripcion, "sin descripcion");
  const desdeCuando = sanitize(body.desde_cuando, "no especificado");
  const reportante = sanitize(body.reportante, "no proporcionado");
  const contacto = sanitize(body.contacto, "no proporcionado");

  console.log("route-incidence input:", {
    accountId, conversationId, conversationDisplayIdHint,
    tipo, ubicacion: ubicacion.slice(0, 60), descripcion: descripcion.slice(0, 60),
    desdeCuando, reportante, contacto,
  });

  if (!Number.isInteger(accountId) || !Number.isInteger(conversationId) || accountId < 1 || conversationId < 1) {
    console.error("missing required ids", { accountId, conversationId });
    return jsonResponse({ error: "account_id and conversation_id are required positive integers", got: { accountId, conversationId } }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const teamName = TIPO_TO_TEAM[tipo] ?? "Coordinación";
  const { data: team, error: teamErr } = await supabase
    .from("teams").select("id, name")
    .eq("account_id", accountId).eq("name", teamName).maybeSingle();
  if (teamErr) return jsonResponse({ error: "team query failed", details: teamErr.message }, 500);
  if (!team) return jsonResponse({ error: `team "${teamName}" not found in account ${accountId}` }, 500);

  const { data: admins } = await supabase
    .from("account_users").select("user_id")
    .eq("account_id", accountId).eq("role", 1);
  const adminIds = (admins ?? []).map((a) => a.user_id);
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("access_tokens").select("token")
    .eq("owner_type", "User").in("owner_id", adminIds).limit(1).maybeSingle();
  if (tokenErr || !tokenRow) {
    return jsonResponse({ error: "no admin access_token found", details: tokenErr?.message }, 500);
  }
  const token = tokenRow.token;

  const { data: conv, error: convErr } = await supabase
    .from("conversations").select("id, display_id, custom_attributes")
    .eq("id", conversationId).eq("account_id", accountId).maybeSingle();
  if (convErr || !conv) {
    return jsonResponse({ error: "conversation not found", details: convErr?.message, conversationId }, 404);
  }
  const displayId = conv.display_id;
  const folio = `INC-${displayId}`;

  const priorityNum = inferPriority(tipo, descripcion);
  const priorityStr = PRIORITY_NAME[priorityNum];

  const noteContent =
    `📋 **INCIDENCIA RECIBIDA — ${folio}**\n\n` +
    `**Tipo:** ${tipo}\n` +
    `**Prioridad:** ${priorityStr.toUpperCase()}\n` +
    `**Área asignada:** ${team.name}\n` +
    `**Ubicación:** ${ubicacion}\n` +
    `**Descripción:** ${descripcion}\n` +
    `**Desde cuándo:** ${desdeCuando}\n` +
    `**Reportante:** ${reportante}\n` +
    `**Contacto:** ${contacto}`;

  const noteResp = await cw(`/api/v1/accounts/${accountId}/conversations/${displayId}/messages`, {
    method: "POST", token,
    body: { content: noteContent, private: true, message_type: "outgoing" },
  });
  if (!noteResp.ok) console.warn("note POST failed:", noteResp.status, noteResp.body);

  const newAttrs = {
    ...(conv.custom_attributes || {}),
    folio, tipo_incidencia: tipo, ubicacion, descripcion, desde_cuando: desdeCuando,
    reportante, contacto, area_asignada: team.name, prioridad: priorityStr,
  };
  const { error: updErr } = await supabase
    .from("conversations")
    .update({ custom_attributes: newAttrs, priority: priorityNum, team_id: team.id })
    .eq("id", conversationId);
  if (updErr) console.warn("conversation update failed:", updErr.message);

  const teamSlug = team.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-");
  const labelList = `area-${teamSlug}, tipo-${tipo}, prioridad-${priorityStr}`;
  await supabase.from("conversations").update({ cached_label_list: labelList }).eq("id", conversationId);

  return jsonResponse({
    ok: true,
    folio,
    team: team.name,
    priority: priorityStr,
    note_status: noteResp.status,
    message: `Reporte registrado con folio ${folio}, derivado al área de ${team.name} con prioridad ${priorityStr}.`,
  });
});

