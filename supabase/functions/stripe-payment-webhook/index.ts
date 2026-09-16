// Edge Function: stripe-payment-webhook (Patch 9, v1)
//
// v1 (13 jun 2026): recibe eventos de Stripe Connect (cuentas conectadas) y,
//   cuando un Payment Link se paga (checkout.session.completed), marca el row
//   en nodo_payment_links como 'paid' e inserta una NOTA PRIVADA en la
//   conversación de Chatwoot: "✅ Pago recibido: X € — concepto".
//   Así el agente ve el cobro dentro del chat sin salir del CRM.
//
// Verifica la firma del webhook (Stripe-Signature) con HMAC-SHA256 contra
// STRIPE_WEBHOOK_SECRET (whsec_...). NO requiere JWT (Stripe lo llama directo).
//
// Eventos manejados:
//   - checkout.session.completed  → marca paid + nota en conversación
//
// Secrets requeridos:
//   STRIPE_WEBHOOK_SECRET  (whsec_... del endpoint Connect en la cuenta CRM)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const CHATWOOT_BASE = "https://go.otronodo.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Verifica la firma Stripe-Signature (t=...,v1=...) con HMAC-SHA256.
async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parts = Object.fromEntries(
      sigHeader.split(",").map((kv) => kv.split("=") as [string, string]),
    );
    const timestamp = parts["t"];
    const v1 = parts["v1"];
    if (!timestamp || !v1) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
    const expected = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Comparación en tiempo constante
    if (expected.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null);
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  // 1. Verificar firma
  if (!WEBHOOK_SECRET) return jsonResponse({ error: "STRIPE_WEBHOOK_SECRET no configurada" }, 500);
  const valid = await verifyStripeSignature(rawBody, sig, WEBHOOK_SECRET);
  if (!valid) return jsonResponse({ error: "firma inválida" }, 400);

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  // Solo nos interesa checkout.session.completed
  if (event.type !== "checkout.session.completed") {
    return jsonResponse({ ok: true, ignored: event.type });
  }

  const session = (event.data as Record<string, unknown>)?.object as Record<string, unknown>;
  const paymentLinkId = session?.payment_link as string | undefined; // plink_XXX
  const amountTotal = Number(session?.amount_total ?? 0); // en cents
  if (!paymentLinkId) return jsonResponse({ ok: true, note: "session sin payment_link" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2. Buscar el link en nuestra tabla por provider_link_id
  const { data: link } = await supabase
    .from("nodo_payment_links")
    .select("*")
    .eq("provider_link_id", paymentLinkId)
    .maybeSingle();

  if (!link) return jsonResponse({ ok: true, note: "payment_link no encontrado en nodo_payment_links" });
  if (link.status === "paid") return jsonResponse({ ok: true, note: "ya estaba marcado paid" });

  // 3. Marcar como paid
  await supabase.from("nodo_payment_links").update({
    status: "paid",
    paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", link.id);

  // 4. Si hay conversación asociada, insertar nota privada con la confirmación
  const convDisplayId = link.conversation_display_id as number | null;
  if (convDisplayId) {
    const token = await getAdminToken(supabase, link.account_id as number);
    if (token) {
      const amountEur = (amountTotal / 100).toFixed(2);
      const noteContent = `✅ *Pago recibido:* ${amountEur} € — ${link.concept ?? "sin concepto"}\n_Vía link de pago Stripe · comisión Nodo: ${((link.fee_cents as number) / 100).toFixed(2)} €_`;
      try {
        await fetch(
          `${CHATWOOT_BASE}/api/v1/accounts/${link.account_id}/conversations/${convDisplayId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", api_access_token: token },
            body: JSON.stringify({ content: noteContent, message_type: "outgoing", private: true }),
          },
        );
      } catch (e) {
        console.error(`[webhook] no se pudo postear nota en conv ${convDisplayId}: ${e}`);
      }
    }
  }

  return jsonResponse({ ok: true, link_id: link.id, status: "paid" });
});

