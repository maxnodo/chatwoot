// Edge Function: sumup-payment-webhook (Patch 9, v2)
//
// v2 (8 ago 2026): resolveSumUpToken ahora refresca el access_token vencido,
//   igual que create-payment-link v10. Sin esto, un pago que llegara más de una
//   hora después de crear el link no se podía verificar y quedaba sin marcar.
// v1: marca el row de nodo_payment_links e inserta una NOTA PRIVADA en la
//   conversación de Chatwoot, igual que con Stripe.
//
// ⚠️ DIFERENCIA CRÍTICA CON STRIPE: SumUp NO FIRMA sus webhooks.
//   No hay HMAC, ni header de autenticación, ni secret compartido. El payload
//   es sólo {"event_type":"CHECKOUT_STATUS_CHANGED","id":"<checkout_id>"} y
//   cualquiera que conozca esta URL puede POSTearlo.
//
//   Por eso esta función NUNCA confía en el evento recibido: lo trata como un
//   simple disparador y confirma el estado real llamando a
//   GET /v0.1/checkouts/{id} contra la API de SumUp. Es lo que la propia doc
//   de SumUp exige ("must always verify if the event really took place").
//   Consecuencia práctica: un POST falso no logra marcar nada como pagado.
//
// Reintentos de SumUp ante respuesta no-2xx: 1 min, 5 min, 20 min y 2 h.
//   Devolvemos 5xx SÓLO ante fallos transitorios y 2xx cuando el evento no nos
//   aplica, para no quedar reintentando durante horas algo que no va a cambiar.
//
// NO requiere JWT: lo llama SumUp directo → desplegar con verify_jwt = false
//
// Secrets requeridos:
//   SUMUP_API_KEY (fase 1) / SUMUP_CLIENT_ID + SUMUP_CLIENT_SECRET (refresh)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUMUP_API_KEY = Deno.env.get("SUMUP_API_KEY") ?? "";
const SUMUP_CLIENT_ID = Deno.env.get("SUMUP_CLIENT_ID") ?? "";
const SUMUP_CLIENT_SECRET = Deno.env.get("SUMUP_CLIENT_SECRET") ?? "";
const CHATWOOT_BASE = "https://go.otronodo.com";

// Ver nota en create-payment-link: refrescamos 5 min antes de vencer.
const TOKEN_SKEW_MS = 5 * 60 * 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function markNeedsReauth(
  supabase: ReturnType<typeof createClient>,
  providerId: unknown,
  reason: string,
): Promise<void> {
  console.error(`[sumup-webhook] provider ${providerId} necesita reautorización: ${reason}`);
  await supabase.from("nodo_payment_providers")
    .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
    .eq("id", providerId);
}

// Bearer válido para SumUp, refrescando si hace falta.
// Duplicado a propósito de create-payment-link: son Edge Functions separadas y
// no comparten módulos. Si se toca una, tocar la otra.
async function resolveSumUpToken(
  supabase: ReturnType<typeof createClient>,
  provider: Record<string, unknown> | null,
): Promise<{ token: string | null; error?: string }> {
  const meta = (provider?.metadata ?? {}) as Record<string, unknown>;
  const oauth = (meta.oauth ?? {}) as Record<string, unknown>;
  const accessToken = typeof oauth.access_token === "string" ? oauth.access_token : null;

  if (!accessToken) {
    return SUMUP_API_KEY ? { token: SUMUP_API_KEY } : { token: null, error: "sin credenciales SumUp" };
  }

  const expiresAt = typeof oauth.expires_at === "string" ? Date.parse(oauth.expires_at) : 0;
  if (expiresAt && expiresAt - TOKEN_SKEW_MS > Date.now()) {
    return { token: accessToken };
  }

  const refreshToken = typeof oauth.refresh_token === "string" ? oauth.refresh_token : null;
  if (!refreshToken) {
    if (provider) await markNeedsReauth(supabase, provider.id, "token vencido y sin refresh_token");
    return { token: null, error: "autorización de SumUp expirada" };
  }
  if (!SUMUP_CLIENT_ID || !SUMUP_CLIENT_SECRET) {
    return { token: null, error: "faltan SUMUP_CLIENT_ID/SUMUP_CLIENT_SECRET para renovar" };
  }

  let body: Record<string, unknown>;
  try {
    const res = await fetch("https://api.sumup.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: SUMUP_CLIENT_ID,
        client_secret: SUMUP_CLIENT_SECRET,
      }).toString(),
    });
    body = await res.json().catch(() => ({}));

    if (!res.ok || !body.access_token) {
      if (res.status === 400 || body?.error === "invalid_grant") {
        if (provider) await markNeedsReauth(supabase, provider.id, `refresh rechazado: ${JSON.stringify(body)}`);
        return { token: null, error: "autorización de SumUp caducada" };
      }
      console.error(`[sumup-webhook] refresh falló (${res.status}): ${JSON.stringify(body)}`);
      return { token: null, error: "no se pudo renovar el token" };
    }
  } catch (e) {
    console.error(`[sumup-webhook] error de red renovando token: ${e}`);
    return { token: null, error: "no se pudo contactar con SumUp para renovar" };
  }

  const newAccess = String(body.access_token);
  const newExpires = new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString();

  if (provider) {
    const { error: saveErr } = await supabase.from("nodo_payment_providers")
      .update({
        metadata: {
          ...meta,
          oauth: {
            ...oauth,
            access_token: newAccess,
            // SumUp puede rotar el refresh_token: guardar el nuevo o el
            // siguiente refresco falla con el viejo ya invalidado.
            refresh_token: body.refresh_token ?? refreshToken,
            expires_at: newExpires,
            refreshed_at: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", provider.id);
    if (saveErr) console.error(`[sumup-webhook] token renovado pero NO persistido: ${saveErr.message}`);
  }

  return { token: newAccess };
}

// Busca un access_token de admin (role=1) de la account para postear en Chatwoot.
async function getAdminToken(
  supabase: ReturnType<typeof createClient>,
  accountId: number,
): Promise<string | null> {
  const { data: admins } = await supabase
    .from("account_users").select("user_id").eq("account_id", accountId).eq("role", 1);
  const adminIds = (admins ?? []).map((a) => a.user_id);
  if (adminIds.length === 0) return null;
  const { data: tokenRow } = await supabase
    .from("access_tokens").select("token")
    .eq("owner_type", "User").in("owner_id", adminIds).limit(1).maybeSingle();
  return (tokenRow?.token as string) ?? null;
}

// Estados de un checkout SumUp. PENDING no es terminal: no tocamos nada.
const STATUS_MAP: Record<string, string> = {
  PAID: "paid",
  FAILED: "failed",
  EXPIRED: "expired",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null);
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let event: Record<string, unknown>;
  try {
    event = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  if (event.event_type !== "CHECKOUT_STATUS_CHANGED") {
    return jsonResponse({ ok: true, ignored: event.event_type ?? null });
  }

  const checkoutId = typeof event.id === "string" ? event.id : null;
  if (!checkoutId) return jsonResponse({ ok: true, note: "evento sin id de checkout" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. ¿Es un link nuestro?
  const { data: link, error: linkErr } = await supabase
    .from("nodo_payment_links").select("*")
    .eq("provider", "sumup").eq("provider_link_id", checkoutId).maybeSingle();

  if (linkErr) {
    console.error(`[sumup-webhook] error consultando link: ${linkErr.message}`);
    return jsonResponse({ error: "error consultando link" }, 500);
  }
  if (!link) return jsonResponse({ ok: true, note: "checkout no encontrado en nodo_payment_links" });
  if (link.status === "paid") return jsonResponse({ ok: true, note: "ya estaba marcado paid" });

  // 2. Token del merchant dueño de este link.
  //    Sin filtrar por status: si quedó en needs_reauth igual queremos poder
  //    verificar un pago ya en curso, no perderlo.
  const { data: provider } = await supabase
    .from("nodo_payment_providers").select("*")
    .eq("account_id", link.account_id).eq("provider", "sumup").maybeSingle();

  const { token, error: tokenError } = await resolveSumUpToken(supabase, provider ?? null);
  if (!token) {
    console.error(`[sumup-webhook] sin token para account ${link.account_id}: ${tokenError}`);
    return jsonResponse({ error: tokenError ?? "sin credenciales SumUp" }, 500);
  }

  // 3. LA VERIFICACIÓN. Nunca confiamos en el payload: preguntamos a SumUp.
  let checkout: Record<string, unknown>;
  try {
    const res = await fetch(`https://api.sumup.com/v0.1/checkouts/${checkoutId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 404) {
      console.warn(`[sumup-webhook] checkout ${checkoutId} no existe en SumUp; evento descartado`);
      return jsonResponse({ ok: true, note: "checkout inexistente en SumUp" });
    }
    if (!res.ok) {
      console.error(`[sumup-webhook] SumUp devolvió ${res.status} al verificar ${checkoutId}`);
      return jsonResponse({ error: "no se pudo verificar contra SumUp" }, 502);
    }
    checkout = await res.json();
  } catch (e) {
    console.error(`[sumup-webhook] fallo de red verificando ${checkoutId}: ${e}`);
    return jsonResponse({ error: "fallo de red verificando" }, 502);
  }

  const remoteStatus = String(checkout.status ?? "").toUpperCase();
  const mapped = STATUS_MAP[remoteStatus];
  if (!mapped) {
    return jsonResponse({ ok: true, note: `estado ${remoteStatus || "desconocido"} sin acción` });
  }

  // 4. Control de importe. La fuente de verdad es SumUp, así que si hay
  //    discrepancia igual registramos el cobro — pero dejamos rastro.
  const remoteCents = Math.round(Number(checkout.amount ?? 0) * 100);
  const expectedCents = Number(link.amount_cents);
  const amountMismatch = mapped === "paid" && remoteCents !== expectedCents;
  if (amountMismatch) {
    console.error(`[sumup-webhook] IMPORTE DISTINTO en ${checkoutId}: esperado ${expectedCents}, SumUp ${remoteCents}`);
  }

  // 5. Actualizar — siempre chequear .error (lección ReputacionIQ)
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: mapped,
    updated_at: nowIso,
    metadata: {
      ...(link.metadata as Record<string, unknown> ?? {}),
      sumup_status: remoteStatus,
      verified_at: nowIso,
      ...(amountMismatch ? { amount_mismatch: { expected_cents: expectedCents, sumup_cents: remoteCents } } : {}),
    },
  };
  if (mapped === "paid") patch.paid_at = nowIso;
  if (mapped !== "paid") patch.error_message = `SumUp reportó estado ${remoteStatus}`;

  const { error: updErr } = await supabase
    .from("nodo_payment_links").update(patch).eq("id", link.id);

  if (updErr) {
    console.error(`[sumup-webhook] update falló: ${updErr.message}`);
    return jsonResponse({ error: "no se pudo actualizar el link" }, 500);
  }

  // 6. Nota privada en la conversación, sólo cuando se cobró.
  //    Sin línea de comisión: con SumUp no existe (fee siempre 0).
  if (mapped === "paid" && link.conversation_display_id) {
    const adminToken = await getAdminToken(supabase, link.account_id as number);
    if (adminToken) {
      const amountEur = (remoteCents / 100).toFixed(2);
      const noteContent =
        `✅ *Pago recibido:* ${amountEur} € — ${link.concept ?? "sin concepto"}\n` +
        `_Vía link de pago SumUp_` +
        (amountMismatch ? `\n⚠️ _El importe cobrado no coincide con el solicitado._` : "");
      try {
        await fetch(
          `${CHATWOOT_BASE}/api/v1/accounts/${link.account_id}/conversations/${link.conversation_display_id}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", api_access_token: adminToken },
            body: JSON.stringify({ content: noteContent, message_type: "outgoing", private: true }),
          },
        );
      } catch (e) {
        // El cobro ya quedó registrado; que falle la nota no debe provocar un
        // reintento que vuelva a procesar todo.
        console.error(`[sumup-webhook] no se pudo postear nota en conv ${link.conversation_display_id}: ${e}`);
      }
    }
  }

  return jsonResponse({ ok: true, link_id: link.id, status: mapped });
});

