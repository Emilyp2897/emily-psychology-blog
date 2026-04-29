import Stripe from "stripe";

export const prerender = false;

const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

function getPlanDetails(plan: string) {
  const planMap: Record<string, { name: string; amount: number }> = {
    individual: { name: "Individual Subscription", amount: 699 },
    team: { name: "Team Subscription", amount: 20000 },
    "online-1-1": { name: "Online 1:1 Session", amount: 2000 },
    "in-person-1-1": { name: "In-Person 1:1 Session", amount: 3000 },
    "pre-season-team": { name: "Pre-Season Team Session", amount: 50000 },
  };

  return planMap[plan] ?? planMap.individual;
}

async function createCheckoutSession(plan: string, email?: string) {
  const site = import.meta.env.PUBLIC_SITE ?? "http://localhost:4321";
  const { name, amount } = getPlanDetails(plan);

  return stripe!.checkout.sessions.create({
    mode: "payment",
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
    const plan = ["individual", "team", "online-1-1", "in-person-1-1", "pre-season-team"].includes(rawPlan)
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