// Edge Function: validate-whatsapp (FASE 1 - productiva)
// Valida si un número tiene WhatsApp via Evolution API y guarda el resultado
// en custom_attributes del contacto en Chatwoot (gonodo).
//
// Uso:
//   POST { "contact_id": 162 }              -> busca el teléfono del contacto y valida
//   POST { "number": "34665153906" }        -> valida el número directo (no guarda si no hay contacto)
//   POST { "contact_id": 162, "number": "..." } -> usa el number provisto y guarda en ese contacto
//
// Guarda en custom_attributes:
//   whatsapp_valid (bool), whatsapp_jid (str), whatsapp_name (str),
//   whatsapp_checked_at (ISO ts), whatsapp_check_status ('ok'|'unreachable')

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const EVOLUTION_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, ""); // sin slash final
const EVOLUTION_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE") ?? "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Normaliza teléfono a solo dígitos
function normalize(phone: string): string {
  return (phone ?? "").replace(/[^0-9]/g, "");
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null);

  if (!EVOLUTION_URL || !EVOLUTION_INSTANCE || !EVOLUTION_API_KEY) {
    return jsonResponse({ error: "faltan secrets de Evolution" }, 500);
  }

  // Parse body
  let contactId: number | null = null;
  let number: string | null = null;
  try {
    const body = JSON.parse(await req.text() || "{}");
    if (body.contact_id != null) contactId = Number(body.contact_id);
    if (body.number != null) number = normalize(String(body.number));
  } catch (_) {
    return jsonResponse({ error: "body JSON inválido" }, 400);
  }

  if (contactId == null && !number) {
    return jsonResponse({ error: "se requiere contact_id o number" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Si hay contact_id pero no number, buscar el teléfono del contacto
  let contactRow: { id: number; phone_number: string | null; custom_attributes: Record<string, unknown> } | null = null;
  if (contactId != null) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, phone_number, custom_attributes")
      .eq("id", contactId)
      .single();
    if (error || !data) {
      return jsonResponse({ error: `contacto ${contactId} no encontrado`, detail: error?.message }, 404);
    }
    contactRow = data as typeof contactRow;
    if (!number) number = normalize(data.phone_number ?? "");
  }

  if (!number) {
    return jsonResponse({ error: "el contacto no tiene teléfono y no se pasó number" }, 400);
  }

  // Llamar a Evolution
  const endpoint = `${EVOLUTION_URL}/chat/whatsappNumbers/${EVOLUTION_INSTANCE}`;
  let exists = false;
  let jid: string | null = null;
  let waName: string | null = null;
  let checkStatus = "ok";
  let evoError: string | null = null;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": EVOLUTION_API_KEY },
      body: JSON.stringify({ numbers: [number] }),
    });
    if (!res.ok) {
      checkStatus = "unreachable";
      evoError = `HTTP ${res.status}`;
    } else {
      const arr = await res.json();
      const first = Array.isArray(arr) ? arr[0] : null;
      if (first) {
        exists = first.exists === true;
        jid = first.jid ?? null;
        waName = first.name ?? null;
      }
    }
  } catch (e) {
    checkStatus = "unreachable";
    evoError = String((e as Error)?.message ?? e);
  }

  const checkedAt = new Date().toISOString();

  // Guardar en custom_attributes si tenemos contacto
  let saved = false;
  if (contactRow) {
    const newAttrs = {
      ...(contactRow.custom_attributes ?? {}),
      whatsapp_valid: exists,
      whatsapp_jid: jid,
      whatsapp_name: waName,
      whatsapp_checked_at: checkedAt,
      whatsapp_check_status: checkStatus,
    };
    const { error: updErr } = await supabase
      .from("contacts")
      .update({ custom_attributes: newAttrs })
      .eq("id", contactRow.id);
    saved = !updErr;
    if (updErr) evoError = (evoError ? evoError + "; " : "") + `update: ${updErr.message}`;
  }

  return jsonResponse({
    ok: checkStatus === "ok",
    contact_id: contactId,
    number,
    whatsapp_valid: exists,
    whatsapp_jid: jid,
    whatsapp_name: waName,
    whatsapp_checked_at: checkedAt,
    check_status: checkStatus,
    saved_to_contact: saved,
    error: evoError,
  });
});

