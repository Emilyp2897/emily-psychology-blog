import Stripe from "stripe";

export const prerender = false;

const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

type PlanDetails = {
  name: string;
  amount: number;
  mode: "payment" | "subscription";
};

function getPlanDetails(plan: string): PlanDetails {
  const planMap: Record<string, PlanDetails> = {
    "programme-6-week": {
      name: "6-Week Physical Performance Plan",
      amount: 1000, // £10.00
      mode: "payment",
    },
    "programme-12-week": {
      name: "12-Week Physical Performance Plan",
      amount: 2000, // £20.00
      mode: "payment",
    },
    "mental-6-week": {
      name: "6-Week Mental Performance Plan",
      amount: 1000, // £10.00
      mode: "payment",
    },
    "mental-12-week": {
      name: "12-Week Mental Performance Plan",
      amount: 2000, // £20.00
      mode: "payment",
    },
  };

  return planMap[plan] ?? planMap["programme-6-week"];
}

const VALID_PLANS = [
  "programme-6-week",
  "programme-12-week",
  "mental-6-week",
  "mental-12-week",
];

async function createCheckoutSession(
  plan: string,
  email?: string,
  intakeToken?: string
) {
  const site = import.meta.env.PUBLIC_SITE ?? "https://mindthegael.co.uk";
  const { name, amount, mode } = getPlanDetails(plan);

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

    const rawPlan = url.searchParams.get("plan") ?? "programme-6-week";
    const plan = VALID_PLANS.includes(rawPlan) ? rawPlan : "programme-6-week";
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