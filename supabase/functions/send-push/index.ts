// Supabase Edge Function: send-push
// Called by the database (notify_user) with { user_id, title, body, page }. Looks up the user's device tokens and sends
// them through Firebase Cloud Messaging (HTTP v1). Needs these secrets (supabase secrets set ...):
//   FIREBASE_SERVICE_ACCOUNT = the whole service-account JSON (one line)
//   PUSH_KEY                 = same random string as the vault secret 'push_function_key'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const b64url = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ""; bytes.forEach(x => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function googleAccessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const jwt = `${head}.${claim}.${b64url(sig)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google token error: " + JSON.stringify(j));
  return j.access_token as string;
}

Deno.serve(async req => {
  if (req.headers.get("x-push-key") !== Deno.env.get("PUSH_KEY")) return new Response("forbidden", { status: 403 });
  const { user_id, title, body, page } = await req.json();
  if (!user_id) return new Response("missing user_id", { status: 400 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows } = await sb.from("device_tokens").select("token").eq("user_id", user_id);
  if (!rows || !rows.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  const sa = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
  const access = await googleAccessToken(sa);
  let sent = 0;
  for (const { token } of rows) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: {
        token, notification: { title: title || "FamilyTree", body: body || "" },
        data: { page: page || "" }, android: { priority: "HIGH", notification: { channel_id: "default", sound: "default" } },
      } }),
    });
    if (r.ok) sent++;
    else if (r.status === 404 || r.status === 400) await sb.from("device_tokens").delete().eq("token", token);   // dead token
  }
  return new Response(JSON.stringify({ sent }), { status: 200 });
});
