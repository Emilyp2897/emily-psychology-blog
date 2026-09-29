/**
 * Server-side gate for the /api/admin/* endpoints.
 *
 * The admin PAGES check who you are in the browser and redirect you away if
 * you are not Emily. The endpoints behind those pages did not check at all,
 * so anyone who knew a URL could call them directly: read every customer's
 * name, email and plan, delete a plan, or trigger plan generation and run up
 * the Anthropic bill. A browser-side check protects the page, never the data.
 *
 * The browser has no cookie to offer here, because supabase-js keeps the
 * session in localStorage. So the admin pages send their Supabase access
 * token in an Authorization header and this verifies it with Supabase, then
 * checks the account is Emily's.
 *
 * Usage, first thing in a handler:
 *
 *   const denied = await requireAdmin(request);
 *   if (denied) return denied;
 */
import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAIL = 'emilyphelan@mindthegael.co.uk';

function deny(message: string, status = 401): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Returns null when the caller is Emily and the request may proceed, or a
 * Response to return immediately when it may not.
 */
export async function requireAdmin(request: Request): Promise<Response | null> {
  const header = request.headers.get('authorization') || '';
  const token = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, '').trim() : '';
  if (!token) return deny('Not signed in.');

  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  // Service role verifies the token without being subject to row-level
  // policies. Falls back to the anon key, which can still validate a JWT,
  // so a missing service role key locks the door rather than opening it.
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return deny('Auth is not configured on the server.', 500);

  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return deny('Not signed in.');
    if ((data.user.email || '').toLowerCase() !== ADMIN_EMAIL) {
      return deny('This account is not allowed here.', 403);
    }
    return null;
  } catch {
    // Never fall open: an unexpected failure here denies the request.
    return deny('Could not verify who you are.', 500);
  }
}
