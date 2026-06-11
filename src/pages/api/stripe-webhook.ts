import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { finalizeIntake } from './programme-finalize';

export const prerender = false;

// POST /api/stripe-webhook
//
// Stripe calls this endpoint when a payment event occurs. The key event
// for Mind the Gael is `checkout.session.completed`: when a customer
// finishes Stripe Checkout for a programme purchase, this fires and we
// generate the plan, regardless of whether the customer's browser
// successfully loaded /programme-success afterwards.
//
// Safety net: the /programme-success page also calls /api/programme-finalize
// from the browser. Both paths converge on the same `finalizeIntake()`
// function, which is idempotent (returns ok=true with `alreadyFinalized`
// flag if the intake has already been processed). So if both fire, the
// second one is a no-op.
//
// Stripe requires the raw request body for signature verification, so
// this handler reads `request.text()` rather than `request.json()`.
//
// To wire up in Stripe:
//   1. Create a webhook endpoint at https://dashboard.stripe.com/webhooks
//      pointing at https://mindthegael.co.uk/api/stripe-webhook
//   2. Subscribe to the event: checkout.session.completed
//   3. Copy the signing secret (whsec_...) into the Vercel environment
//      variable STRIPE_WEBHOOK_SECRET
//   4. Redeploy

export const POST: APIRoute = async ({ request }) => {
  const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;
  const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    console.error('[stripe-webhook] missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return new Response('Webhook not configured.', { status: 500 });
  }

  const stripe = new Stripe(stripeSecretKey);
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing Stripe-Signature header.', { status: 400 });
  }

  // Read the raw body for signature verification.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error('[stripe-webhook] signature verification failed:', err?.message ?? err);
    return new Response('Invalid signature.', { status: 400 });
  }

  // We only care about completed checkout sessions for programme purchases.
  if (event.type !== 'checkout.session.completed') {
    // Acknowledge so Stripe stops retrying this event type.
    return new Response('Event type not handled, acknowledged.', { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const token = session.metadata?.intake_token;
  const plan = session.metadata?.plan;

  // Only programme purchases carry an intake_token. Subscription purchases
  // (the blog subscription, "individual" plan) have no intake to finalize;
  // acknowledge and move on.
  if (!token) {
    console.log('[stripe-webhook] checkout.session.completed without intake_token (likely subscription); plan=', plan);
    return new Response('No intake token; nothing to finalize.', { status: 200 });
  }

  if (!session.id) {
    console.error('[stripe-webhook] checkout.session.completed missing session id');
    return new Response('Missing session id.', { status: 400 });
  }

  try {
    const result = await finalizeIntake({ token, sessionId: session.id });
    if (!result.ok) {
      // Log but still return 200 so Stripe does not retry an event we
      // have already determined cannot be finalized (e.g. red flag, not
      // paid, intake not found).
      console.warn(
        '[stripe-webhook] finalizeIntake declined:',
        result.status,
        result.error,
        'token=',
        token,
        'session=',
        session.id,
      );
      return new Response(`Acknowledged. ${result.error}`, { status: 200 });
    }

    if (result.alreadyFinalized) {
      console.log('[stripe-webhook] intake already finalized (likely by the success page); token=', token);
    } else {
      console.log(
        '[stripe-webhook] finalized intake via webhook;',
        'token=', token,
        'sentFullPlanToClient=', result.sentFullPlanToClient,
      );
    }

    return new Response('Finalized.', { status: 200 });
  } catch (err: any) {
    // 500 lets Stripe retry. Useful if a transient failure (Anthropic
    // outage, Resend hiccup) means the next webhook delivery has a better
    // shot. Stripe retries with exponential backoff for up to 3 days.
    console.error('[stripe-webhook] finalizeIntake threw:', err?.message ?? err);
    return new Response('Internal error; will retry.', { status: 500 });
  }
};
