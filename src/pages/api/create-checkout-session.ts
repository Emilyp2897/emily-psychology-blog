import Stripe from "stripe";

export const prerender = false;

const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

type PlanDetails = {
  name: string;
  amount: number;
  mode: "payment" | "subscription";
  interval?: "month";
  trialDays?: number;
};

function getPlanDetails(plan: string): PlanDetails {
  const planMap: Record<string, PlanDetails> = {
    individual: {
      name: "Individual Monthly Subscription (Founding Offer)",
      amount: 500,
      mode: "subscription",
      interval: "month",
      trialDays: 14,
    },
    team: {
      name: "Team Monthly Subscription",
      amount: 7500,
      mode: "subscription",
      interval: "month",
    },
    "team-6m": {
      name: "Team Online Subscription (6-Month Outright)",
      amount: 40500,
      mode: "payment",
    },
    "team-12m": {
      name: "Team Online Subscription (12-Month Outright)",
      amount: 72000,
      mode: "payment",
    },
    "online-1-1": { name: "Online 1:1 Session", amount: 2000, mode: "payment" },
    "in-person-1-1": { name: "In-Person 1:1 Session", amount: 3000, mode: "payment" },
    "pre-season-team": { name: "Pre-Season Team Programme (6 Weeks)", amount: 125000, mode: "payment" },
  };

  return planMap[plan] ?? planMap.individual;
}

async function createCheckoutSession(plan: string, email?: string) {
  const site = import.meta.env.PUBLIC_SITE ?? "http://localhost:4321";
  const { name, amount, mode, interval, trialDays } = getPlanDetails(plan);

  const priceData = {
    currency: "gbp",
    product_data: { name },
    unit_amount: amount,
    ...(mode === "subscription" && interval ? { recurring: { interval } } : {}),
  };

  return stripe!.checkout.sessions.create({
    mode,
    ...(email ? { customer_email: email } : {}),
    ...(mode === "subscription" && trialDays ? { subscription_data: { trial_period_days: trialDays } } : {}),
    line_items: [
      {
        price_data: priceData,
        quantity: 1,
      },
    ],
    success_url: `${site}/success`,
    cancel_url: `${site}/cancel`,
  });
}

export const GET = async ({ url }: { url: URL }) => {
  try {
    if (!stripe) {
      return new Response("Missing STRIPE_SECRET_KEY", { status: 500 });
    }

    const rawPlan = url.searchParams.get("plan") ?? "individual";
    const plan = [
      "individual",
      "team",
      "team-6m",
      "team-12m",
      "online-1-1",
      "in-person-1-1",
      "pre-season-team",
    ].includes(rawPlan)
      ? rawPlan
      : "individual";
    const session = await createCheckoutSession(plan);

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
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    let body: { email?: string; plan?: string } = {};

    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON request body" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log("BODY:", body);

    const email = body?.email;
    const plan = body?.plan;

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const session = await createCheckoutSession(plan ?? "individual", email);

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (err: any) {
    console.error("Stripe error:", err);

    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};