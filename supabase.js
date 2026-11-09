import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && publishableKey && !url.includes('YOUR_PROJECT_REF'))
export const supabase = supabaseConfigured ? createClient(url, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null

// Google blocks sign-in inside an app WebView (error 403 disallowed_useragent), so inside the Android app
// the login page is opened in the phone's real browser (Chrome Custom Tab) and comes back through this link.
export const NATIVE_REDIRECT = 'com.sharma.familytree://login-callback'
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Supabase is not configured')
  if (isNative()) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true }
    })
    if (error) throw error
    const B = window.Capacitor.Plugins && window.Capacitor.Plugins.Browser
    if (B) await B.open({ url: data.url })
    else window.open(data.url, '_system')
    return
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  })
  if (error) throw error
}

// Called when the app is re-opened by the com.sharma.familytree://login-callback link.
export async function handleNativeAuthUrl(url) {
  if (!supabase || !url || !url.startsWith(NATIVE_REDIRECT)) return false
  const q = new URLSearchParams((url.split('?')[1] || '').split('#')[0])
  const h = new URLSearchParams(url.split('#')[1] || '')
  const get = k => h.get(k) || q.get(k)
  const err = get('error_description') || get('error')
  if (err) throw new Error(err)
  const access_token = get('access_token'), refresh_token = get('refresh_token'), code = get('code')
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token })
    if (error) throw error
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw error
  } else return false
  try { const B = window.Capacitor.Plugins && window.Capacitor.Plugins.Browser; if (B) await B.close() } catch (e) {}
  return true
}

export async function sendPhoneOtp(phone) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.auth.signInWithOtp({ phone })
  if (error) throw error
}

export async function verifyPhoneOtp(phone, token) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
  if (error) throw error
  return data
}
