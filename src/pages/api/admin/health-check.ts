import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { sql } from '../../../lib/db';

export const prerender = false;

// GET /api/admin/health-check
//
// One-stop diagnostic for pilot launch readiness. Reports on:
//   1. Presence of every env var the platform needs.
//   2. Live ping to each external service (Anthropic, Stripe, Resend,
//      Supabase, Vercel Postgres) using the configured keys.
//
// Returns: { checks: [{ name, status: 'ok'|'warn'|'fail', detail }],
//            allOk: boolean }
//
// No auth on this endpoint deliberately for the pilot — it surfaces
// presence/absence of secret keys, NOT the keys themselves. Once the
// site goes live, gate it behind admin auth.

type Check = { name: string; status: 'ok' | 'warn' | 'fail'; detail: string };

function presence(name: string, value: any): Check {
  if (!value) return { name, status: 'fail', detail: 'Not set' };
  const masked =
    typeof value === 'string' && value.length > 8
      ? `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`
      : 'set';
  return { name, status: 'ok', detail: masked };
}

async function checkAnthropic(key: string | undefined): Promise<Check> {
  if (!key) return { name: 'Anthropic API ping', status: 'fail', detail: 'ANTHROPIC_API_KEY missing.' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 4,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.ok) return { name: 'Anthropic API ping', status: 'ok', detail: 'Auth + completion call succeeded.' };
    const body = await res.text().catch(() => '');
    return { name: 'Anthropic API ping', status: 'fail', detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (err: any) {
    return { name: 'Anthropic API ping', status: 'fail', detail: err?.message || 'Unknown error' };
  }
}

async function checkStripe(key: string | undefined): Promise<Check> {
  if (!key) return { name: 'Stripe API ping', status: 'fail', detail: 'STRIPE_SECRET_KEY missing.' };
  const mode = key.startsWith('sk_live_') ? 'LIVE' : key.startsWith('sk_test_') ? 'TEST' : 'UNKNOWN';
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { name: 'Stripe API ping', status: 'ok', detail: `${mode} key, /v1/balance returned 200.` };
    const body = await res.text().catch(() => '');
    return { name: 'Stripe API ping', status: 'fail', detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (err: any) {
    return { name: 'Stripe API ping', status: 'fail', detail: err?.message || 'Unknown error' };
  }
}

async function checkResend(key: string | undefined): Promise<Check> {
  if (!key) return { name: 'Resend API ping', status: 'fail', detail: 'RESEND_API_KEY missing.' };
  try {
    const res = await fetch('https://api.resend.com/api-keys', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { name: 'Resend API ping', status: 'ok', detail: '/api-keys returned 200 — key is valid.' };
    const body = await res.text().catch(() => '');
    return { name: 'Resend API ping', status: 'fail', detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (err: any) {
    return { name: 'Resend API ping', status: 'fail', detail: err?.message || 'Unknown error' };
  }
}

async function checkSupabase(url: string | undefined, serviceKey: string | undefined): Promise<Check> {
  if (!url || !serviceKey) {
    return {
      name: 'Supabase API ping',
      status: 'fail',
      detail: !url ? 'PUBLIC_SUPABASE_URL missing.' : 'SUPABASE_SERVICE_ROLE_KEY missing.',
    };
  }
  try {
    const supabase = createClient(url, serviceKey);
    const { error } = await supabase.from('Plans').select('id').limit(1);
    if (error) {
      return { name: 'Supabase API ping', status: 'fail', detail: `Plans query failed: ${error.message}` };
    }
    return { name: 'Supabase API ping', status: 'ok', detail: 'Service-role key authenticated, Plans readable.' };
  } catch (err: any) {
    return { name: 'Supabase API ping', status: 'fail', detail: err?.message || 'Unknown error' };
  }
}

async function checkPostgres(): Promise<Check> {
  try {
    const result = await sql<{ ok: number }>`SELECT 1 as ok`;
    if (result.rows.length > 0) {
      return { name: 'Vercel Postgres ping', status: 'ok', detail: 'SELECT 1 succeeded.' };
    }
    return { name: 'Vercel Postgres ping', status: 'fail', detail: 'Empty result.' };
  } catch (err: any) {
    return { name: 'Vercel Postgres ping', status: 'fail', detail: err?.message || 'Unknown error' };
  }
}

export const GET: APIRoute = async () => {
  const env = import.meta.env;

  const presenceChecks: Check[] = [
    presence('ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY),
    presence('STRIPE_SECRET_KEY', env.STRIPE_SECRET_KEY),
    presence('STRIPE_WEBHOOK_SECRET', env.STRIPE_WEBHOOK_SECRET),
    presence('RESEND_API_KEY', env.RESEND_API_KEY),
    presence('CONSULTATION_FROM_EMAIL', env.CONSULTATION_FROM_EMAIL),
    presence('PUBLIC_SUPABASE_URL', env.PUBLIC_SUPABASE_URL),
    presence('PUBLIC_SUPABASE_ANON_KEY', env.PUBLIC_SUPABASE_ANON_KEY),
    presence('SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY),
    presence('POSTGRES_URL', env.POSTGRES_URL),
    presence('PUBLIC_SITE', env.PUBLIC_SITE),
    presence('PUBLIC_FEEDBACK_ENABLED', env.PUBLIC_FEEDBACK_ENABLED ?? 'true (default)'),
  ];

  const pingChecks = await Promise.all([
    checkAnthropic(env.ANTHROPIC_API_KEY),
    checkStripe(env.STRIPE_SECRET_KEY),
    checkResend(env.RESEND_API_KEY),
    checkSupabase(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
    checkPostgres(),
  ]);

  const checks = [...presenceChecks, ...pingChecks];
  const allOk = checks.every((c) => c.status === 'ok');

  return new Response(JSON.stringify({ checks, allOk }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
