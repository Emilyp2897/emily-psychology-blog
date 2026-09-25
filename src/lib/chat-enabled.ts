/**
 * Public kill switch for the Saoirse chatbot.
 *
 * Every Saoirse message costs an Anthropic API call, so the chat is off on
 * the public site by default. The code is all still here and untouched:
 * the panel in Footer.astro, the /chat page, the /api/chat endpoint and its
 * prompt. Nothing has been deleted. This flag only decides whether any of it
 * is reachable by a visitor.
 *
 * To turn Saoirse back on, set PUBLIC_CHAT_ENABLED=true in the environment
 * (.env locally, Vercel project settings in production) and redeploy.
 *
 * Off means three things, so there is no way in through a side door:
 *   1. Footer.astro does not render the shamrock button or the chat panel.
 *   2. /chat redirects to /resources.
 *   3. /api/chat returns 503 before it ever constructs an Anthropic client,
 *      so a hand-crafted POST cannot run up a bill either.
 */
export const CHAT_ENABLED = import.meta.env.PUBLIC_CHAT_ENABLED === 'true';
