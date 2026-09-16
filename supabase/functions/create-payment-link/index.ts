// Edge Function: create-payment-link (Patch 9, v10 - refresh de tokens OAuth)
//
// v10 (8 ago 2026): resolveSumUpToken ahora comprueba la expiración y refresca.
//   Los access_token de SumUp duran ~1 h; sin esto la fase 2 dejaba de cobrar
//   una hora después de conectar cada cliente.
// v9 (8 ago 2026): soporte multi-provider real (stripe | sumup).
//   - El provider ya no está hardcodeado: se resuelve desde nodo_payment_providers.
//   - El caller puede forzarlo con {provider: "sumup"}; si no, se usa el más
//     antiguo activo de la cuenta (preserva el comportamiento previo: Stripe).
//   - FIX: el GET usaba .maybeSingle() sin filtrar por provider. En cuanto una
//     cuenta tuviera dos providers activos devolvía error y el botón € del
//     composer desaparecía. Ahora lista todos.
//   - SumUp NO tiene application fee (no existe equivalente a Stripe Connect):
//     para provider="sumup" la comisión SIEMPRE se fuerza a 0.
// v7 (13 jun 2026): GET ?account_id=N devuelve {enabled} para que el botón
//   del composer se muestre/oculte según si la cuenta tiene pagos.
// v3-v6: CORS para llamada desde browser.
// v1: MVP Stripe Connect direct charges + application_fee.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUMUP_API_KEY = Deno.env.get("SUMUP_API_KEY") ?? "";
const SUMUP_CLIENT_ID = Deno.env.get("SUMUP_CLIENT_ID") ?? "";
const SUMUP_CLIENT_SECRET = Deno.env.get("SUMUP_CLIENT_SECRET") ?? "";

const MAX_AMOUNT_EUR = 10_000; // tope de seguridad por link
const SUPPORTED_PROVIDERS = ["stripe", "sumup"] as const;
type ProviderName = (typeof SUPPORTED_PROVIDERS)[number];

// Refrescamos 5 min ANTES de que venza, no cuando ya venció. Además de cubrir
// el desfase de reloj, achica la ventana en la que dos peticiones simultáneas
// intentarían refrescar a la vez (SumUp rota el refresh_token, así que dos
// refrescos en paralelo pueden invalidarse entre sí).
const TOKEN_SKEW_MS = 5 * 60 * 1000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Resultado uniforme de cualquier provider, para que el resto del flujo
// (auditoría + respuesta) no tenga que saber con quién habló.
interface LinkResult {
  ok: boolean;
  url?: string;
  providerLinkId?: string;
  feeCents: number;
  metadata: Record<string, unknown>;
  errorDetail?: unknown;
  errorMessage?: string;
}

// ---------------------------------------------------------------- Stripe ---

async function stripePost(
  path: string,
  params: Record<string, string>,
  connectedAccount?: string,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (connectedAccount) headers["Stripe-Account"] = connectedAccount;

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

async function createStripeLink(
  provider: Record<string, unknown>,
  amountCents: number,
  currency: string,
  concept: string,
): Promise<LinkResult> {
  if (!STRIPE_KEY) {
    return { ok: false, feeCents: 0, metadata: {}, errorMessage: "STRIPE_SECRET_KEY no configurada en Supabase secrets" };
  }

  const connectedAcct = provider.connected_account_id as string;
  const feeCents = Math.round(amountCents * Number(provider.commission_percent) / 100);

  const price = await stripePost("prices", {
    "currency": currency,
    "unit_amount": String(amountCents),
    "product_data[name]": concept.slice(0, 250),
  }, connectedAcct);

  if (!price.ok) {
    return { ok: false, feeCents, metadata: {}, errorMessage: "stripe rechazó la creación del price", errorDetail: price.body?.error ?? price.body };
  }

  const linkParams: Record<string, string> = {
    "line_items[0][price]": String(price.body.id),
    "line_items[0][quantity]": "1",
  };
  if (feeCents > 0) linkParams["application_fee_amount"] = String(feeCents);

  const link = await stripePost("payment_links", linkParams, connectedAcct);

  if (!link.ok) {
    return { ok: false, feeCents, metadata: {}, errorMessage: "stripe rechazó la creación del payment link", errorDetail: link.body?.error ?? link.body };
  }

  return {
    ok: true,
    url: link.body.url as string,
    providerLinkId: String(link.body.id),
    feeCents,
    metadata: { connected_account: connectedAcct, commission_percent: provider.commission_percent },
  };
}

// ----------------------------------------------------------------- SumUp ---

// Marca el provider como "hay que volver a autorizar". Al dejar de estar
// 'active' desaparece de las búsquedas: el cobro falla con un mensaje claro en
// vez de emitir links rotos, y el botón € se oculta hasta reconectar.
async function markNeedsReauth(
  supabase: ReturnType<typeof createClient>,
  providerId: unknown,
  reason: string,
): Promise<void> {
  console.error(`[sumup] provider ${providerId} necesita reautorización: ${reason}`);
  await supabase.from("nodo_payment_providers")
    .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
    .eq("id", providerId);
}

// Devuelve un Bearer válido para SumUp, refrescando si hace falta.
//
// Fase 1 (cuenta propia): no hay metadata.oauth → se usa el secret SUMUP_API_KEY.
// Fase 2 (cuenta de cliente vía OAuth): access_token guardado, que caduca a la
//   hora y se renueva con el refresh_token.
async function resolveSumUpToken(
  supabase: ReturnType<typeof createClient>,
  provider: Record<string, unknown>,
): Promise<{ token: string | null; error?: string }> {
  const meta = (provider.metadata ?? {}) as Record<string, unknown>;
  const oauth = (meta.oauth ?? {}) as Record<string, unknown>;
  const accessToken = typeof oauth.access_token === "string" ? oauth.access_token : null;

  // Sin OAuth → fase 1.
  if (!accessToken) {
    return SUMUP_API_KEY
      ? { token: SUMUP_API_KEY }
      : { token: null, error: "SUMUP_API_KEY no configurada y la cuenta no tiene token OAuth" };
  }

  const expiresAt = typeof oauth.expires_at === "string" ? Date.parse(oauth.expires_at) : 0;
  if (expiresAt && expiresAt - TOKEN_SKEW_MS > Date.now()) {
    return { token: accessToken };
  }

  // Vencido (o a punto): renovar.
  const refreshToken = typeof oauth.refresh_token === "string" ? oauth.refresh_token : null;
  if (!refreshToken) {
    await markNeedsReauth(supabase, provider.id, "token vencido y sin refresh_token");
    return { token: null, error: "la autorización de SumUp expiró; hay que reconectar la cuenta" };
  }
  if (!SUMUP_CLIENT_ID || !SUMUP_CLIENT_SECRET) {
    return { token: null, error: "faltan SUMUP_CLIENT_ID/SUMUP_CLIENT_SECRET para renovar el token" };
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
      // invalid_grant = el refresh_token ya no sirve. Reintentar es inútil:
      // sólo una reautorización del comerciante lo arregla.
      if (res.status === 400 || body?.error === "invalid_grant") {
        await markNeedsReauth(supabase, provider.id, `refresh rechazado: ${JSON.stringify(body)}`);
        return { token: null, error: "la autorización de SumUp caducó; hay que reconectar la cuenta" };
      }
      console.error(`[sumup] refresh falló (${res.status}): ${JSON.stringify(body)}`);
      return { token: null, error: "no se pudo renovar el token de SumUp" };
    }
  } catch (e) {
    // Fallo de red: NO marcamos needs_reauth, la autorización sigue siendo válida.
    console.error(`[sumup] error de red renovando token: ${e}`);
    return { token: null, error: "no se pudo contactar con SumUp para renovar el token" };
  }

  const newAccess = String(body.access_token);
  const newExpires = new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString();

  // SumUp puede rotar el refresh_token: si devuelve uno nuevo hay que guardarlo
  // o el siguiente refresco falla con el viejo ya invalidado.
  const { error: saveErr } = await supabase.from("nodo_payment_providers")
    .update({
      metadata: {
        ...meta,
        oauth: {
          ...oauth,
          access_token: newAccess,
          refresh_token: body.refresh_token ?? refreshToken,
          expires_at: newExpires,
          refreshed_at: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", provider.id);

  if (saveErr) {
    // El token sirve para ESTA petición, pero si no se persistió y SumUp rotó
    // el refresh_token, el próximo refresco va a fallar. Queda en el log.
    console.error(`[sumup] token renovado pero NO persistido: ${saveErr.message}`);
  }

  return { token: newAccess };
}

async function createSumUpLink(
  supabase: ReturnType<typeof createClient>,
  provider: Record<string, unknown>,
  accountId: number,
  amountCents: number,
  currency: string,
  concept: string,
): Promise<LinkResult> {
  const { token, error: tokenError } = await resolveSumUpToken(supabase, provider);
  if (!token) {
    return { ok: false, feeCents: 0, metadata: {}, errorMessage: tokenError ?? "sin credenciales de SumUp" };
  }

  const merchantCode = provider.connected_account_id as string;

  // checkout_reference: identificador propio, único, máx 90 chars.
  const reference = `nodo-${accountId}-${crypto.randomUUID()}`;

  // SumUp NO tiene panel de webhooks: la URL de notificación se registra por
  // checkout, en `return_url`. Sin esto nunca sabríamos que el link se pagó.
  // (Ojo: `return_url` es el webhook server-to-server; `redirect_url` sería a
  //  dónde mandar el navegador del cliente después de pagar — no lo usamos.)
  const webhookUrl = `${SUPABASE_URL}/functions/v1/sumup-payment-webhook`;

  // Diferencias con Stripe que hay que respetar sí o sí:
  //  - amount va en unidades MAYORES (10.10), no en céntimos.
  //  - currency en MAYÚSCULAS (EUR), Stripe la quiere en minúsculas.
  //  - sin hosted_checkout.enabled la respuesta NO trae hosted_checkout_url.
  const res = await fetch("https://api.sumup.com/v0.1/checkouts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      checkout_reference: reference,
      amount: amountCents / 100,
      currency: currency.toUpperCase(),
      merchant_code: merchantCode,
      description: concept.slice(0, 250),
      hosted_checkout: { enabled: true },
      return_url: webhookUrl,
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    // 401 con un token que creíamos válido: la autorización se revocó del lado
    // del comerciante. Lo marcamos para que no siga emitiendo intentos fallidos.
    if (res.status === 401) {
      await markNeedsReauth(supabase, provider.id, "SumUp devolvió 401 al crear el checkout");
    }
    return { ok: false, feeCents: 0, metadata: {}, errorMessage: "sumup rechazó la creación del checkout", errorDetail: body };
  }

  const url = body.hosted_checkout_url;
  if (!url) {
    // Defensivo: 200 sin URL significa que el hosted checkout no se habilitó.
    // Sin esto el link se guardaría en auditoría con url null y el agente
    // enviaría un mensaje vacío al cliente (silent failure).
    return { ok: false, feeCents: 0, metadata: {}, errorMessage: "sumup no devolvió hosted_checkout_url", errorDetail: body };
  }

  return {
    ok: true,
    url: url as string,
    providerLinkId: String(body.id ?? reference),
    // SumUp no tiene application fee: la comisión de plataforma NO existe.
    feeCents: 0,
    metadata: {
      merchant_code: merchantCode,
      checkout_reference: reference,
      checkout_id: body.id ?? null,
      commission_percent: 0,
    },
  };
}

// ------------------------------------------------------------------ HTTP ---

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // GET ?account_id=N → status: ¿la cuenta tiene pagos habilitados?
  if (req.method === "GET") {
    const url = new URL(req.url);
    const accId = Number(url.searchParams.get("account_id"));
    if (!accId || Number.isNaN(accId)) return jsonResponse({ enabled: false, providers: [] });

    // Sin .maybeSingle(): con dos providers activos (stripe + sumup) reventaba.
    const { data, error } = await supabase
      .from("nodo_payment_providers")
      .select("provider, commission_percent, currency")
      .eq("account_id", accId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(`[create-payment-link] GET status falló: ${error.message}`);
      return jsonResponse({ enabled: false, providers: [] });
    }

    const providers = (data ?? []).filter((p) =>
      SUPPORTED_PROVIDERS.includes(p.provider as ProviderName)
    );

    // `enabled` se mantiene por compatibilidad con el composer actual.
    return jsonResponse({
      enabled: providers.length > 0,
      providers: providers.map((p) => ({
        provider: p.provider,
        currency: p.currency,
        commission_percent: p.provider === "sumup" ? 0 : Number(p.commission_percent),
      })),
    });
  }

  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const accountId = Number(payload.account_id);
  const amount = Number(payload.amount);
  const concept = String(payload.concept ?? "").trim();
  const convDisplayId = payload.conversation_display_id ? Number(payload.conversation_display_id) : null;
  const requestedProvider = payload.provider ? String(payload.provider).toLowerCase() : null;

  if (!accountId || Number.isNaN(accountId)) return jsonResponse({ error: "account_id requerido" }, 400);
  if (!amount || Number.isNaN(amount) || amount <= 0) return jsonResponse({ error: "amount debe ser > 0" }, 400);
  if (amount > MAX_AMOUNT_EUR) return jsonResponse({ error: `amount supera el tope de ${MAX_AMOUNT_EUR} EUR` }, 400);
  if (!concept) return jsonResponse({ error: "concept requerido" }, 400);
  if (requestedProvider && !SUPPORTED_PROVIDERS.includes(requestedProvider as ProviderName)) {
    return jsonResponse({ error: `provider "${requestedProvider}" no soportado`, supported: SUPPORTED_PROVIDERS }, 400);
  }

  // 1. Resolver el provider de esta cuenta.
  let query = supabase
    .from("nodo_payment_providers")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "active");

  if (requestedProvider) query = query.eq("provider", requestedProvider);

  const { data: providers, error: provErr } = await query
    .order("created_at", { ascending: true })
    .limit(1);

  if (provErr) return jsonResponse({ error: "error consultando provider", detail: provErr.message }, 500);

  const provider = providers?.[0];
  if (!provider) {
    return jsonResponse({
      error: requestedProvider
        ? `la cuenta ${accountId} no tiene ${requestedProvider} conectado o está deshabilitado`
        : `la cuenta ${accountId} no tiene ningún proveedor de pagos activo`,
    }, 404);
  }

  const providerName = String(provider.provider).toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(providerName as ProviderName)) {
    return jsonResponse({ error: `la cuenta ${accountId} tiene configurado el provider "${providerName}", que esta función no sabe manejar` }, 501);
  }

  const amountCents = Math.round(amount * 100);
  const currency = (provider.currency as string) || "eur";

  // 2. Despacho por provider.
  const result: LinkResult = providerName === "sumup"
    ? await createSumUpLink(supabase, provider, accountId, amountCents, currency, concept)
    : await createStripeLink(provider, amountCents, currency, concept);

  if (!result.ok) {
    const status = result.errorDetail ? 502 : 500;
    return jsonResponse({ error: result.errorMessage, detail: result.errorDetail }, status);
  }

  // 3. Auditoría — siempre chequear .error (lección ReputacionIQ)
  const { data: auditRow, error: auditErr } = await supabase
    .from("nodo_payment_links")
    .insert({
      account_id: accountId,
      conversation_display_id: convDisplayId,
      provider: providerName,
      provider_link_id: result.providerLinkId,
      url: result.url,
      amount_cents: amountCents,
      fee_cents: result.feeCents,
      currency,
      concept,
      status: "created",
      metadata: result.metadata,
    })
    .select("id")
    .single();

  if (auditErr) {
    console.error(`[create-payment-link] auditoría falló: ${auditErr.message}`);
    return jsonResponse({
      ok: true, url: result.url, amount, fee: result.feeCents / 100,
      provider: providerName, warning: "link creado pero auditoría no registrada",
    });
  }

  return jsonResponse({
    ok: true, url: result.url, amount, fee: result.feeCents / 100,
    currency, provider: providerName, link_id: auditRow.id, concept,
  });
});

