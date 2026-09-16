// Edge Function: sumup-oauth-callback (Patch 9, v2)
//
// Paso 2 del flujo OAuth de SumUp: recibe el ?code= tras la autorización del
// comerciante, lo canjea por tokens y los guarda en nodo_payment_providers.
//
// verify_jwt = false OBLIGATORIO: a esta URL llega el NAVEGADOR del comerciante
// redirigido por SumUp, sin ningún JWT de Supabase. Con el default (true) SumUp
// redirige y el comerciante ve un 401.
//
// La protección no es el JWT sino el `state`: se generó en sumup-oauth-start
// tras validar que quien inició era admin de esa cuenta, es de un solo uso y
// caduca a los 15 minutos.
//
// v2 (8 ago 2026): el chequeo de SUMUP_CLIENT_ID/SECRET se movió DESPUÉS de
//   validar el state. Antes iba primero, así que un state falsificado recibía
//   "configuración incompleta" en vez del rechazo por state inválido.
//
// Devuelve HTML (no JSON): lo lee una persona en su navegador.
//
// Secrets requeridos:
//   SUMUP_CLIENT_ID / SUMUP_CLIENT_SECRET
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUMUP_CLIENT_ID = Deno.env.get("SUMUP_CLIENT_ID") ?? "";
const SUMUP_CLIENT_SECRET = Deno.env.get("SUMUP_CLIENT_SECRET") ?? "";

function page(title: string, message: string, ok: boolean, status = 200): Response {
  const color = ok ? "#0d8b73" : "#c0392b";
  const icon = ok ? "✅" : "⚠️";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f0f2f5;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px">
<div style="background:#fff;border-radius:16px;padding:32px;max-width:420px;box-shadow:0 2px 16px rgba(0,0,0,.08);text-align:center">
<div style="font-size:40px;line-height:1">${icon}</div>
<h1 style="color:${color};font-size:20px;margin:16px 0 8px">${title}</h1>
<p style="color:#64748b;font-size:15px;line-height:1.5;margin:0">${message}</p>
</div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return page("Método no permitido", "Esta URL sólo responde a redirecciones de SumUp.", false, 405);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // El comerciante puede haber pulsado "denegar" en la pantalla de SumUp.
  if (oauthError) {
    return page("Autorización cancelada", `SumUp devolvió: ${oauthError}. No se conectó ninguna cuenta.`, false, 400);
  }
  if (!code || !state) return page("Enlace incompleto", "Falta el código o el estado de la autorización. Volvé a iniciar el proceso.", false, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Validar el state: existe, no se usó y no caducó.
  //    Va ANTES de mirar la configuración para que un state falsificado reciba
  //    el rechazo que corresponde y no información sobre nuestro setup.
  const { data: stateRow } = await supabase
    .from("nodo_oauth_states").select("*")
    .eq("state", state).eq("provider", "sumup").maybeSingle();

  if (!stateRow) return page("Estado inválido", "No reconocemos esta autorización. Por seguridad no se conectó nada.", false, 400);
  if (stateRow.used_at) return page("Enlace ya utilizado", "Esta autorización ya se había completado. Si necesitás reconectar, empezá de nuevo.", false, 400);
  if (new Date(stateRow.expires_at as string) < new Date()) {
    return page("Enlace caducado", "La autorización expiró (son 15 minutos). Volvé a iniciar el proceso.", false, 400);
  }

  if (!SUMUP_CLIENT_ID || !SUMUP_CLIENT_SECRET) {
    console.error("[sumup-oauth-callback] faltan SUMUP_CLIENT_ID/SECRET");
    return page("Configuración incompleta", "La integración con SumUp no está configurada del todo. Avisá al equipo técnico.", false, 500);
  }

  // 2. Canjear el code por tokens.
  const redirectUri = `${SUPABASE_URL}/functions/v1/sumup-oauth-callback`;
  let tokens: Record<string, unknown>;
  try {
    const res = await fetch("https://api.sumup.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: SUMUP_CLIENT_ID,
        client_secret: SUMUP_CLIENT_SECRET,
        redirect_uri: redirectUri,
      }).toString(),
    });
    tokens = await res.json();
    if (!res.ok || !tokens.access_token) {
      console.error(`[sumup-oauth-callback] canje fallido (${res.status}): ${JSON.stringify(tokens)}`);
      return page("No se pudo completar", "SumUp rechazó la autorización. Probá de nuevo en unos minutos.", false, 502);
    }
  } catch (e) {
    console.error(`[sumup-oauth-callback] error de red canjeando: ${e}`);
    return page("No se pudo completar", "No pudimos contactar con SumUp. Probá de nuevo en unos minutos.", false, 502);
  }

  const accessToken = String(tokens.access_token);
  const expiresIn = Number(tokens.expires_in ?? 3600);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // 3. Averiguar el merchant_code: es lo que create-payment-link necesita para
  //    emitir cobros, y no viene en la respuesta del token.
  let merchantCode: string | null = null;
  try {
    const meRes = await fetch("https://api.sumup.com/v0.1/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      merchantCode = me?.merchant_profile?.merchant_code ?? me?.merchant_code ?? null;
    }
  } catch (e) {
    console.error(`[sumup-oauth-callback] no se pudo leer /me: ${e}`);
  }

  if (!merchantCode) {
    // Sin merchant_code no se puede cobrar: mejor no dejar un provider a medias
    // que aparezca como activo y falle en el primer intento de cobro.
    console.error("[sumup-oauth-callback] sin merchant_code; no se guarda el provider");
    return page("Falta un dato de la cuenta", "Conectamos con SumUp pero no pudimos leer el identificador del comercio. Avisá al equipo técnico.", false, 502);
  }

  // 4. Guardar credenciales. Upsert manual: si la cuenta ya tenía SumUp, se
  //    actualiza en vez de duplicar el provider.
  const accountId = stateRow.account_id as number;
  const oauthMeta = {
    access_token: accessToken,
    refresh_token: tokens.refresh_token ?? null,
    expires_at: expiresAt,
    scope: tokens.scope ?? null,
    connected_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("nodo_payment_providers").select("id, metadata")
    .eq("account_id", accountId).eq("provider", "sumup").maybeSingle();

  const row = {
    account_id: accountId,
    provider: "sumup",
    connected_account_id: merchantCode,
    // SumUp no permite comisión de plataforma: siempre 0 (ver create-payment-link).
    commission_percent: 0,
    currency: "eur",
    status: "active",
    updated_at: new Date().toISOString(),
  };

  const { error: saveErr } = existing
    ? await supabase.from("nodo_payment_providers")
        .update({ ...row, metadata: { ...(existing.metadata as Record<string, unknown> ?? {}), oauth: oauthMeta } })
        .eq("id", existing.id)
    : await supabase.from("nodo_payment_providers")
        .insert({ ...row, metadata: { oauth: oauthMeta } });

  if (saveErr) {
    console.error(`[sumup-oauth-callback] no se pudo guardar el provider: ${saveErr.message}`);
    return page("No se pudo guardar", "Autorizaste correctamente pero no pudimos guardar la conexión. Avisá al equipo técnico.", false, 500);
  }

  // 5. Quemar el state recién ahora: si algo falló antes, el comerciante puede
  //    reintentar con el mismo enlace en vez de tener que empezar de cero.
  await supabase.from("nodo_oauth_states")
    .update({ used_at: new Date().toISOString() }).eq("state", state);

  return page(
    "Cuenta de SumUp conectada",
    `Ya podés cobrar desde el chat. Comercio: ${merchantCode}. Podés cerrar esta ventana.`,
    true,
  );
});

