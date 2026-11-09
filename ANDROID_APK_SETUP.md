# FamilyTree Android APK + Push Notifications

App ID: `com.sharma.familytree` · Firebase project: `familytree-ed3f6` · App loads **https://family.1infinity.online**
(so website updates reach the app without a new APK; only native changes need a new APK).

## A. APK banana (GitHub se, PC par kuch install nahi)
1. Is poore folder ko ek GitHub repo me daalo (branch `main`). `android/app/google-services.json` repo me rehni chahiye.
2. GitHub → **Actions → Build Android APK → Run workflow**.
3. ~5-8 min baad run ke neeche **Artifacts → FamilyTree-apk** download karo → andar `.apk` hai → phone me install karo
   ("Install unknown apps" allow karna padega).
   (Pehli baar debug-signed APK banta hai. Play Store ke liye keystore secrets baad me add karenge.)

PC par banana ho to: `npm install && npm run cap:sync` phir Android Studio me `android/` folder kholo → Build → Build APK.

## B. Push notifications on karna (ek baar)
1. **Supabase SQL editor** me `supabase/supabase-push.sql` run karo.
2. **Firebase** → Project settings → **Service accounts → Generate new private key** → JSON file download (ISE KISI KO MAT BHEJNA).
3. Supabase CLI se (ya Dashboard → Edge Functions → Secrets):
   ```
   supabase functions deploy send-push --no-verify-jwt
   supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" PUSH_KEY="<koi-lambi-random-string>"
   ```
4. SQL editor me (values badal kar) ye 2 lines run karo — `PUSH_KEY` wali string wahi honi chahiye:
   ```
   select vault.create_secret('https://<PROJECT-REF>.supabase.co/functions/v1/send-push', 'push_function_url');
   select vault.create_secret('<WAHI-RANDOM-STRING>', 'push_function_key');
   ```
5. APK install karke login karo → "Notifications allow" dabao. Doosre account se message bhejo → push aana chahiye.

Abhi push in par jata hai: **naya direct message**, **naya join request (owner/admin ko)**.
Aur type jodne ke liye bas `perform public.notify_user(<user_id>, 'Title', 'Body', '<page>');` kisi trigger se call karo.
