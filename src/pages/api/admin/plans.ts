import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const supabase = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending_review';

  const { data: plans, error } = await supabase
    .from('Plans')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: usersData } = await supabase.auth.admin.listUsers();
  const users = usersData?.users || [];

  const plansWithEmail = (plans || []).map((plan: any) => {
    const user = users.find((u: any) => u.id === plan.user_id);
    return {
      ...plan,
      customer_email: user?.email || 'Unknown',
      customer_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
    };
  });

  return new Response(JSON.stringify({ plans: plansWithEmail }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
