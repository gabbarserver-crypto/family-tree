# Auto backup e-mail (sirf tab jab changes hue ho)

Roz raat 12:00 baje (IST) tree ke owner + saare admins ko mail jata hai: backup file + "kisne kya badla" ki list.
Agar pichhle backup ke baad koi edit/delete nahi hua to **mail nahi jata**.

1. Supabase SQL editor: `supabase/supabase-edit-log.sql`, `supabase-trash.sql` (pehle se chali ho to chhod do), phir `supabase/supabase-backup-mail.sql` run karo.
2. https://resend.com par free account banao → API Keys → key banao. Domain verify karo (1infinity.online) taaki
   `backup@1infinity.online` jaise address se mail ja sake. (Bina domain verify ke Resend sirf aapke apne account-email par bhejta hai.)
3. Edge Function deploy aur secrets:
   ```
   supabase functions deploy send-backup --no-verify-jwt
   supabase secrets set RESEND_API_KEY="re_xxx" MAIL_FROM="FamilyTree Backup <backup@1infinity.online>" PUSH_KEY="<wahi random string jo send-push me rakhi thi>"
   ```
4. Dashboard → Database → Extensions me **pg_cron** aur **pg_net** on karo, phir `supabase-backup-mail.sql` ke neeche comment me jo 2 commands hain
   (`vault.create_secret(... 'backup_function_url')` aur `cron.schedule(...)`) values bharkar run karo. `push_function_key` secret pehle se `supabase-push.sql` se bana hona chahiye.
5. Test: Dashboard → Edge Functions → send-backup → Invoke (header `x-push-key` dekar). Pehli baar poora backup jayega; uske baad sirf badlav hone par.
