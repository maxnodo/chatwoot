// Edge Function: sumup-oauth-start (Patch 9, v2)
//
// Paso 1 del flujo OAuth de SumUp (fase 2: conectar la cuenta de un cliente).
// Devuelve la URL de autorización a la que el frontend debe redirigir.
//
// POR QUÉ POST Y NO UNA REDIRECCIÓN DIRECTA:
//   Quien inicia el flujo decide a qué account_id del CRM se va a enganchar la
//   cuenta SumUp resultante. Si esto fuera un simple GET público, un atacante
//   podría arrancar el flujo para el account_id de OTRO y completarlo con SU
//   propia cuenta SumUp: a partir de ahí, los cobros de ese cliente irián a
//   parar al bolsillo del atacante. Por eso exigimos un token de admin de
//   Chatwoot en un header y devolvemos la URL, en vez de redirigir de una.
//
// v2 (8 ago 2026): el chequeo de SUMUP_CLIENT_ID se movió DESPUÉS de validar
//   que quien llama es admin. Antes iba primero y filtraba el estado de
//   configuración interna a cualquiera con la anon key.
//
// Uso desde el composer:
//   POST { account_id }  +  header x-chatwoot-token: <api_access_token del admin>
//   → { authorize_url }   y el frontend hace window.location = authorize_url
//
// Secrets requeridos:
//   SUMUP_CLIENT_ID
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUMUP_CLIENT_ID = Deno.env.get("SUMUP_CLIENT_ID") ?? "";

// Scopes mínimos para crear cobros y consultar su estado.
// OJO: `payments` requiere verificación MANUAL de SumUp; sin ella el authorize
// devuelve error de scope inválido por más que el client_id sea correcto.
const SCOPES = ["payments", "transactions.history"];

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-chatwoot-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ¿El token pertenece a un admin (role=1) de esa cuenta de Chatwoot?
async function isAccountAdmin(
  supabase: ReturnType<typeof createClient>,
  accountId: number,
  token: string,
): Promise<boolean> {
  const { data: tokenRow } = await supabase
    .from("access_tokens").select("owner_id, owner_type")
    .eq("token", token).eq("owner_type", "User").maybeSingle();
  if (!tokenRow) return false;

  const { data: membership } = await supabase
    .from("account_users").select("id")
    .eq("account_id", accountId).eq("user_id", tokenRow.owner_id).eq("role", 1)
    .maybeSingle();
  return !!membership;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const chatwootToken = req.headers.get("x-chatwoot-token") ?? "";
  if (!chatwootToken) return jsonResponse({ error: "falta header x-chatwoot-token" }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const accountId = Number(payload.account_id);
  if (!accountId || Number.isNaN(accountId)) return jsonResponse({ error: "account_id requerido" }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!(await isAccountAdmin(supabase, accountId, chatwootToken))) {
    // Mismo mensaje para token inválido y para admin de otra cuenta: no damos
    // pistas sobre qué account_ids existen.
    return jsonResponse({ error: "no autorizado para esta cuenta" }, 403);
  }

  // Recién acá, con el llamador ya autenticado, revelamos si falta configuración.
  if (!SUMUP_CLIENT_ID) {
    return jsonResponse({ error: "SUMUP_CLIENT_ID no configurada en Supabase secrets" }, 500);
  }

  // State antifalsificación: se valida al volver en el callback.
  const state = crypto.randomUUID();
  const { error: stateErr } = await supabase.from("nodo_oauth_states").insert({
    state,
    account_id: accountId,
    provider: "sumup",
    redirect_to: typeof payload.redirect_to === "string" ? payload.redirect_to : null,
  });

  if (stateErr) {
    // Sin state persistido no se puede validar la vuelta: cortamos acá en vez
    // de arrancar un flujo que el callback va a rechazar igual.
    console.error(`[sumup-oauth-start] no se pudo guardar el state: ${stateErr.message}`);
    return jsonResponse({ error: "no se pudo iniciar la autorización" }, 500);
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/sumup-oauth-callback`;
  const authorizeUrl = new URL("https://api.sumup.com/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", SUMUP_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", SCOPES.join(" "));
  authorizeUrl.searchParams.set("state", state);

  return jsonResponse({ authorize_url: authorizeUrl.toString(), state });
});

