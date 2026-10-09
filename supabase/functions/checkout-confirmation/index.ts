import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const mailgunApiKey = Deno.env.get('MAILGUN_API_KEY');
  const mailgunDomain = Deno.env.get('MAILGUN_DOMAIN');
  const mailgunFrom = Deno.env.get('MAILGUN_FROM');
  const mailgunApiBase = Deno.env.get('MAILGUN_API_BASE');
  if (!authorization || !supabaseUrl || !anonKey) return response({ error: 'Sign in to continue.' }, 401);
  if (!mailgunApiKey || !mailgunDomain || !mailgunFrom || !mailgunApiBase) {
    return response({ error: 'Checkout email is not configured on the server.' }, 503);
  }

  const token = authorization.replace(/^Bearer\s+/i, '');
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return response({ error: 'Sign in to continue.' }, 401);

    const body = await request.json();
    const orderId = typeof body.order_id === 'string' ? body.order_id : '';
    if (!orderId) return response({ error: 'An order reference is required.' }, 400);

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id,customer_name,customer_email,total_amount,created_at')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();
    if (orderError || !order) return response({ error: 'Order not found.' }, 404);

    const recipient = order.customer_email || user.email;
    if (!recipient) return response({ error: 'No email address is available for this account.' }, 400);

    const email = new FormData();
    email.set('from', mailgunFrom);
    email.set('to', recipient);
    email.set('subject', `Bum Flex order confirmation ${order.id}`);
    email.set('text', `Hi ${order.customer_name},\n\nYour Bum Flex order has been received.\nOrder reference: ${order.id}\nTotal: ₦${Number(order.total_amount).toLocaleString('en-NG')}\n\nThank you for shopping with Bum Flex.`);
    const mailgunResponse = await fetch(`${mailgunApiBase.replace(/\/$/, '')}/v3/${encodeURIComponent(mailgunDomain)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`api:${mailgunApiKey}`)}`,
      },
      body: email,
    });
    if (!mailgunResponse.ok) {
      console.error('Mailgun rejected the checkout email:', mailgunResponse.status, await mailgunResponse.text());
      return response({ error: 'The order was saved, but the confirmation email could not be sent.' }, 502);
    }

    return response({ sent: true });
  } catch (error) {
    console.error('Checkout confirmation failed:', error);
    return response({ error: 'The confirmation email could not be sent.' }, 500);
  }
});
