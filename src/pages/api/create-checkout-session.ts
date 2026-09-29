import Stripe from "stripe";

export const prerender = false;

const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

type PlanDetails = {
  name: string;
  amount: number;
  mode: "payment" | "subscription";
};

// The 6-Week Mental Performance Plan is the only paid product on Mind the
// Gael. Everything else (all four content series, the Gael Performance
// Toolkit, the Mental Health Workbook, the chatbot, the workshops) is free.
//
// The £10 physical plan was retired here. It was still live in Stripe and in
// the Terms, but it had no way in: the intake modal that fed it has no trigger
// button anywhere on /personal-training, so the only way to reach a £10
// checkout was a hand-written URL.
//
// Keep the price in sync with /pricing and the homepage Mental Performance
// Plans band.
const PLANS: Record<string, PlanDetails> = {
  "mental-6-week": {
    name: "6-Week Mental Performance Plan",
    amount: 200, // £2.00
    mode: "payment",
  },
};

const VALID_PLANS = Object.keys(PLANS);

async function createCheckoutSession(
  plan: string,
  email?: string,
  intakeToken?: string
) {
  // Trimmed, because this comes from an environment variable that is
  // pasted by hand. A leading space took live checkout down: the value
  // was " https://mindthegael.co.uk", so success_url and cancel_url both
  // began with a space and Stripe rejected the session with "Not a valid
  // URL". A trailing slash would double up against the paths below, so
  // that goes too. Falls back when the value is empty or only spaces.
  const site =
    (import.meta.env.PUBLIC_SITE ?? "").trim().replace(/\/+$/, "") ||
    "https://mindthegael.co.uk";
  // Callers validate against VALID_PLANS before getting here, so an unknown
  // key is a programming error rather than bad user input. Throwing is the
  // right response: the old code fell back to a default plan, which meant a
  // bad key silently charged for something the customer had not chosen.
  const details = PLANS[plan];
  if (!details) {
    throw new Error(`Unknown plan "${plan}". Valid plans: ${VALID_PLANS.join(", ")}`);
  }
  const { name, amount, mode } = details;

  const successUrl = `${site}/programme-success?session_id={CHECKOUT_SESSION_ID}&plan=${plan}${
    intakeToken ? `&token=${encodeURIComponent(intakeToken)}` : ""
  }`;

  return stripe!.checkout.sessions.create({
    mode,
    ...(email ? { customer_email: email } : {}),
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: { name },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    metadata: {
      plan,
      ...(intakeToken ? { intake_token: intakeToken } : {}),
    },
    success_url: successUrl,
    cancel_url: `${site}/cancel`,
  });
}

export const GET = async ({ url }: { url: URL }) => {
  try {
    if (!stripe) {
      return new Response("Missing STRIPE_SECRET_KEY", { status: 500 });
    }

    // Rejected rather than defaulted. This used to fall back to the £10
    // physical plan, so a stale or misspelled link sent someone to a checkout
    // for a product they had not asked for at a price they had not seen.
    const plan = url.searchParams.get("plan") ?? "mental-6-week";
    if (!VALID_PLANS.includes(plan)) {
      return new Response("Invalid plan selected.", { status: 400 });
    }

    const intakeToken = url.searchParams.get("token") || undefined;
    const session = await createCheckoutSession(plan, undefined, intakeToken);

    if (!session.url) {
      return new Response("Unable to create checkout URL", { status: 500 });
    }

    return Response.redirect(session.url, 303);
  } catch (err: any) {
    console.error("Stripe GET error:", err);
    return new Response("Unable to create checkout session", { status: 500 });
  }
};

export const POST = async ({ request }: { request: Request }) => {
  try {
    if (!stripe) {
      return new Response(
        JSON.stringify({ error: "Missing STRIPE_SECRET_KEY" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    let body: { email?: string; plan?: string; token?: string } = {};

    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const email = body?.email;
    const plan = body?.plan;

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!plan || !VALID_PLANS.includes(plan)) {
      return new Response(
        JSON.stringify({ error: "Invalid plan selected." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const session = await createCheckoutSession(plan, email, body?.token);

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Stripe error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};