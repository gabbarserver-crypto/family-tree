// Supabase Edge Function: send-backup  (called once a day by pg_cron)
// For every tree: if there were changes since the last backup, e-mail the owner + admins a backup file and the list of changes.
// No changes -> no e-mail. Secrets (supabase secrets set ...):
//   RESEND_API_KEY = API key from resend.com      MAIL_FROM = e.g. "FamilyTree Backup <backup@1infinity.online>"   PUSH_KEY = same key as send-push
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const b64 = (s: string) => { const b = new TextEncoder().encode(s); let t = ""; b.forEach(x => (t += String.fromCharCode(x))); return btoa(t); };
const FIELD: Record<string, string> = { full_name: "Name", dob: "Date of birth", gender: "Gender", nickname: "Nickname", birth_place: "Birth place", current_place: "Current place", life_status: "Life status", avatar_url: "Profile photo", mobile: "Mobile", email: "Email", claimed_by: "Profile claimed", status: "Profile status" };
const label = (f: string) => FIELD[f] || f.replace(/^details\./, "").replace(/_/g, " ");

Deno.serve(async req => {
  if (req.headers.get("x-push-key") !== Deno.env.get("PUSH_KEY")) return new Response("forbidden", { status: 403 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: trees, error } = await sb.rpc("backup_trees");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const report: unknown[] = [];
  for (const t of trees || []) {
    if (!t.emails?.length) { report.push({ tree: t.tree_name, skipped: "no recipients" }); continue; }
    const { data: c, error: ce } = await sb.rpc("backup_collect", { p_tree: t.tree_id, p_since: t.last_sent_at });
    if (ce) { report.push({ tree: t.tree_name, error: ce.message }); continue; }
    if (!c.change_count) { report.push({ tree: t.tree_name, skipped: "no changes" }); continue; }   // nothing new -> no mail

    const day = new Date().toISOString().slice(0, 10);
    const rows = (c.changes as any[]).slice(0, 60).map(x => {
      const what = x.action === "created" ? "Profile banaya" : x.action === "updated" ? (x.changes || []).map((k: any) => label(k.field)).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ")
        : x.action === "relationship_added" ? "Relation juda: " + (x.changes?.[0]?.new || "") : "Relation hata: " + (x.changes?.[0]?.new || "");
      return `<tr><td>${esc(new Date(x.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}</td><td>${esc(x.actor_name)}</td><td>${esc(x.person)}</td><td>${esc(what)}</td></tr>`;
    }).join("");
    const del = (c.deleted as any[]).map(x => `<li>🗑️ <b>${esc(x.person)}</b> — ${esc(x.by)} ne delete kiya (${esc(new Date(x.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))})</li>`).join("");
    const html = `<div style="font-family:Arial,sans-serif"><h2>${esc(t.tree_name)} — backup (${day})</h2>
      <p>Pichhle backup ke baad <b>${c.change_count}</b> badlav hue. Poora backup file attach hai.</p>
      ${del ? `<h3>Delete hue profiles</h3><ul>${del}</ul>` : ""}
      <h3>Badlav</h3><table border="1" cellpadding="6" style="border-collapse:collapse;font-size:13px"><tr><th>Kab</th><th>Kisne</th><th>Kiska profile</th><th>Kya</th></tr>${rows}</table>
      ${c.change_count > 60 ? `<p>… aur ${c.change_count - 60} badlav (poori list app ke Activity Log me).</p>` : ""}
      <p style="color:#777;font-size:12px">Is mail me sirf tab aata hai jab koi badlav hua ho. Backup file JSON hai; GEDCOM ke liye app me Import/Export page dekhein.</p></div>`;
    const file = { exported_at: new Date().toISOString(), tree: t.tree_name, persons: c.persons, tree_members: c.tree_members, relationships: c.relationships };

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("MAIL_FROM"), to: t.emails, subject: `FamilyTree backup ${day} — ${c.change_count} badlav`, html,
        attachments: [{ filename: `FamilyTree-backup-${day}.json`, content: b64(JSON.stringify(file, null, 1)) }] }),
    });
    if (r.ok) { await sb.rpc("backup_mark_sent", { p_tree: t.tree_id, p_count: c.change_count }); report.push({ tree: t.tree_name, sent: t.emails.length, changes: c.change_count }); }
    else report.push({ tree: t.tree_name, error: await r.text() });
  }
  return new Response(JSON.stringify(report), { status: 200, headers: { "Content-Type": "application/json" } });
});
