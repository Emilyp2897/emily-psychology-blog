// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.PUBLIC_SUPABASE_URL
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY

// createClient throws a bare "supabaseUrl is required" when these are
// missing. That happens while the module is still being evaluated, so every
// page importing it dies before rendering anything, and the user just sees
// whatever placeholder was in the HTML. This makes the cause explicit.
//
// Both are PUBLIC_ vars, so they are inlined at build time. They live in
// .env.local for local work, which is gitignored and never reaches Vercel,
// so they must also be set in the Vercel project settings. They are set
// there for Production and Preview; this guard is for new environments and
// for local builds run without .env.local.
if (!url || !anonKey) {
  throw new Error(
    'Supabase is not configured: PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY ' +
    'are missing from this build. Set them in the Vercel project environment ' +
    'variables and redeploy.'
  )
}

export const supabase = createClient(url, anonKey)

// supabase-js serialises every auth call behind a Web Lock keyed on the
// client's storage key. When that lock is contended or was orphaned by a
// tab that went away mid-call, the promise it returns never settles: not
// resolved, not rejected, just pending forever.
//
// That is fatal at the top level of a page script. `await
// supabase.auth.getUser()` never returns, so no statement after it ever
// runs, and the page sits on whatever placeholder markup the HTML shipped
// with, with nothing in the console. A plain try/catch does not help,
// because a promise that never settles never reaches the catch.
//
// Racing against a timer converts the hang into an ordinary rejection the
// caller can catch and turn into a visible error state.
const AUTH_TIMEOUT_MS = 8000

function withTimeout(promise, label) {
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${AUTH_TIMEOUT_MS / 1000}s.`)),
      AUTH_TIMEOUT_MS
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Resolves to the signed-in user, or null when there is no session.
// Throws on a real auth error or on timeout, so callers must wrap this.
export async function getUserOrThrow() {
  const { data, error } = await withTimeout(
    supabase.auth.getUser(),
    'Authentication check'
  )
  if (error) throw error
  return data?.user ?? null
}

// Resolves to the access token, or null when there is no session.
export async function getAccessTokenOrThrow() {
  const { data, error } = await withTimeout(
    supabase.auth.getSession(),
    'Session lookup'
  )
  if (error) throw error
  return data?.session?.access_token ?? null
}
