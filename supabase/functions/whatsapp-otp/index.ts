// Supabase Auth "Send SMS" hook -> sends the login OTP on WhatsApp (Meta WhatsApp Cloud API).
// Supabase makes + verifies the OTP itself; this function only DELIVERS it.
//
// Deploy:  supabase functions deploy whatsapp-otp --no-verify-jwt
// Secrets: supabase secrets set SEND_SMS_HOOK_SECRET='v1,whsec_xxx' WA_ACCESS_TOKEN='EAAG...' \
//            WA_PHONE_NUMBER_ID='123456789' WA_TEMPLATE_NAME='familytree_login_otp' WA_TEMPLATE_LANG='en'
// Then: Supabase Dashboard > Authentication > Hooks > Send SMS > HTTPS > this function's URL.
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const HOOK_SECRET = (Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
const WA_TOKEN = Deno.env.get("WA_ACCESS_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const WA_TEMPLATE = Deno.env.get("WA_TEMPLATE_NAME") ?? "familytree_login_otp";
const WA_LANG = Deno.env.get("WA_TEMPLATE_LANG") ?? "en";
const GRAPH = Deno.env.get("WA_GRAPH_VERSION") ?? "v21.0";

const fail = (code: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code: code, message } }), { status: code, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!HOOK_SECRET || !WA_TOKEN || !WA_PHONE_ID) return fail(500, "WhatsApp OTP secrets are not configured");
  const payload = await req.text();
  let user: { phone?: string }, sms: { otp?: string };
  try {
    ({ user, sms } = new Webhook(HOOK_SECRET).verify(payload, Object.fromEntries(req.headers)) as any);
  } catch (_e) {
    return fail(401, "Invalid hook signature");
  }
  const to = String(user?.phone ?? "").replace(/\D/g, "");   // WhatsApp wants digits only: 919876543210
  const otp = String(sms?.otp ?? "");
  if (!to || !otp) return fail(400, "Missing phone or otp");

  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
      template: {
        name: WA_TEMPLATE, language: { code: WA_LANG },
        components: [
          { type: "body", parameters: [{ type: "text", text: otp }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otp }] },   // copy-code button
        ],
      },
    }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    console.error("WhatsApp send failed", r.status, JSON.stringify(j));
    return fail(502, "WhatsApp OTP bhejne me error: " + (j?.error?.message ?? r.status));
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
});
