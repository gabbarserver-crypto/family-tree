# FamilyTree — WhatsApp OTP login setup

Flow: user number daalta hai -> Supabase OTP banata hai -> Send SMS Hook (Edge Function `whatsapp-otp`) -> Meta WhatsApp Cloud API -> user ke WhatsApp par OTP -> Supabase verify. App ka frontend code (`sendPhoneOtp` / `verifyPhoneOtp`) wahi rehta hai.

## 1. Meta (developers.facebook.com > FamilyTree app)
1. App Dashboard > **Add product > WhatsApp** (API Setup).
2. **Business portfolio link karo** (FamilyTree app abhi kisi business se linked nahi dikh rahi; GRD Motors wali linked hai).
3. WhatsApp Business Account (WABA) + ek phone number. Testing ke liye Meta ka test number milta hai, par wo sirf "To" list me add kiye 5 numbers ko bhejta hai. Real users ke liye apna number register karna padega (usme pehle se normal WhatsApp account nahi hona chahiye).
4. **Permanent token**: Business Settings > Users > System users > naya system user > WABA assign karo > token generate karo (permission `whatsapp_business_messaging`). API Setup wala temporary token 24 ghante me expire ho jata hai.
5. Note karo: **Phone number ID** aur **WABA ID**.
6. **Template banao** (WhatsApp Manager > Message templates > Authentication): naam `familytree_login_otp`, language English, button "Copy code", expiry 10 min. Ya API se:
```
curl -X POST "https://graph.facebook.com/v21.0/<WABA_ID>/message_templates" \
 -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
 -d '{"name":"familytree_login_otp","language":"en","category":"authentication",
      "components":[{"type":"body","add_security_recommendation":true},
                    {"type":"footer","code_expiration_minutes":10},
                    {"type":"buttons","buttons":[{"type":"otp","otp_type":"copy_code"}]}]}'
```
   Approval ka wait karo (status APPROVED hona chahiye).
7. Sab real users ke liye app ko **Live mode** me daalna padega (privacy policy URL chahiye). Development mode me sirf app ke roles/test numbers kaam karte hain.

## 2. Supabase (FamilyTree wala project, ref sqxtwqynchgeqfyaogsl)
1. Authentication > Providers > **Phone: Enable**. Koi Twilio provider set karne ki zaroorat nahi, hook sab sambhalega.
2. Authentication > Hooks > **Send SMS** > type **HTTPS** > URL: `https://sqxtwqynchgeqfyaogsl.supabase.co/functions/v1/whatsapp-otp` > "Generate secret" > secret copy karo (`v1,whsec_...`) > Create.
3. Terminal (supabase CLI, project linked):
```
supabase secrets set SEND_SMS_HOOK_SECRET='v1,whsec_XXXX' WA_ACCESS_TOKEN='EAAG...' WA_PHONE_NUMBER_ID='123456789' WA_TEMPLATE_NAME='familytree_login_otp' WA_TEMPLATE_LANG='en'
supabase functions deploy whatsapp-otp --no-verify-jwt
```
4. Frontend: naya `app.js` deploy karo (Vercel). Login page par ab "Continue with WhatsApp OTP" hai.

## Check / debug
- Supabase > Edge Functions > whatsapp-otp > Logs: Meta ka error message yahin dikhta hai.
- "Template name does not exist" => naam/language mismatch (WA_TEMPLATE_LANG `en` vs `en_US`) ya template approve nahi hua.
- "Recipient not in allowed list" => app Development mode me hai ya test number use ho raha hai.
- OTP 1 ghante tak valid hai by default; Auth > Providers > Phone me OTP expiry/length badal sakte ho.
- Authentication templates ka Meta paid charge lagta hai (per message), rate Meta ke pricing page par dekho.
