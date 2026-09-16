// Edge Function: get-account-usage
//
// Devuelve el conteo de conversaciones del mes actual para un account de Chatwoot,
// comparado contra el limite del plan.
//
// Deploy: proyecto gonodo (ntncrklsckzmoaincafs) — donde vive la DB de Chatwoot.
// Auth: verify_jwt=true. El caller debe mandar la anon/publishable key de gonodo.
//
// Request POST JSON:   { account_id: number }
// Request GET param:   ?account_id=N
//
// Response 200:
//   {
//     account_id, account_name, plan,
//     limit, used_this_month, remaining, percent_used,
//     month_start_utc, month_end_utc, server_now_utc
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Limites por plan. Ampliable cuando aparezcan planes pagos.
const PLAN_LIMITS: Record<string, number> = {
  free: 500,
  growth: 2000,
  pro: 10000,
};
const DEFAULT_PLAN = "free";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function firstOfMonthUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function firstOfNextMonthUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  // Extraer account_id de body (POST) o query (GET)
  let accountId: number | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.account_id != null) accountId = Number(body.account_id);
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
  } else if (req.method === "GET") {
    const u = new URL(req.url);
    const raw = u.searchParams.get("account_id");
    if (raw) accountId = Number(raw);
  } else {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (accountId == null || !Number.isInteger(accountId) || accountId < 1) {
    return jsonResponse(
      { error: "account_id must be a positive integer" },
      400,
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Info del account (name + plan custom_attribute)
  const { data: acc, error: accErr } = await supabase
    .from("accounts")
    .select("id, name, custom_attributes")
    .eq("id", accountId)
    .maybeSingle();

  if (accErr) {
    console.error("account query error:", accErr);
    return jsonResponse(
      { error: "Failed to query account", details: accErr.message },
      500,
    );
  }
  if (!acc) {
    return jsonResponse({ error: "Account not found", account_id: accountId }, 404);
  }

  const customAttrs = (acc.custom_attributes ?? {}) as Record<string, unknown>;
  const rawPlan = typeof customAttrs.plan === "string"
    ? (customAttrs.plan as string).toLowerCase()
    : DEFAULT_PLAN;
  const plan = rawPlan in PLAN_LIMITS ? rawPlan : DEFAULT_PLAN;
  const limit = PLAN_LIMITS[plan];

  // 2. Conteo del mes actual (UTC)
  const monthStart = firstOfMonthUtc();
  const monthEnd = firstOfNextMonthUtc();

  const { count, error: countErr } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", monthEnd.toISOString());

  if (countErr) {
    console.error("conversations count error:", countErr);
    return jsonResponse(
      { error: "Failed to count conversations", details: countErr.message },
      500,
    );
  }

  const used = count ?? 0;
  const remaining = Math.max(0, limit - used);
  const percent = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;

  return jsonResponse({
    account_id: acc.id,
    account_name: acc.name,
    plan,
    limit,
    used_this_month: used,
    remaining,
    percent_used: percent,
    month_start_utc: monthStart.toISOString(),
    month_end_utc: monthEnd.toISOString(),
    server_now_utc: new Date().toISOString(),
  });
});

