import { getCollection } from 'astro:content';
import Anthropic from '@anthropic-ai/sdk';

export const prerender = false;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

const requestBuckets = new Map<string, number[]>();

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatSafetyMeta = {
  banner: string;
  emergency: string;
  resourcesUrl: string;
};

type ChatSuccessResponse = {
  reply: string;
  sources: { title: string; url: string }[];
  usedModel: boolean;
  safety: ChatSafetyMeta;
};

type ChatErrorResponse = {
  error: string;
  safety: ChatSafetyMeta;
};

type ChatApiResponse = ChatSuccessResponse | ChatErrorResponse;

function getClientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip) return `ip:${ip}`;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return `ip:${realIp.trim()}`;

  return 'ip:unknown';
}

function isRateLimited(clientKey: string): boolean {
  const now = Date.now();
  const existing = requestBuckets.get(clientKey) || [];
  const recent = existing.filter((timestamp) => now - timestamp <= RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestBuckets.set(clientKey, recent);
    return true;
  }

  recent.push(now);
  requestBuckets.set(clientKey, recent);
  return false;
}

function logChatEvent(input: {
  status: 'ok' | 'rate-limited' | 'crisis' | 'error' | 'bad-request';
  clientKey: string;
  usedModel?: boolean;
  message: string;
  sourceCount?: number;
}) {
  if (import.meta.env.CHAT_ANALYTICS_ENABLED === 'false') return;

  const safeClient = input.clientKey.replace(/ip:/, '').replace(/\d+$/g, 'x');
  console.info('[chat-analytics]', {
    at: new Date().toISOString(),
    status: input.status,
    client: safeClient,
    messageLength: input.message.length,
    usedModel: Boolean(input.usedModel),
    sourceCount: input.sourceCount || 0,
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function scorePost(questionTokens: string[], post: KnowledgePost): number {
  const haystack = `${post.title} ${post.description} ${post.track} ${post.text}`.toLowerCase();
  let score = 0;

  for (const token of questionTokens) {
    if (post.title.toLowerCase().includes(token)) score += 4;
    if (post.description.toLowerCase().includes(token)) score += 3;
    if (post.track.toLowerCase().includes(token)) score += 2;
    if (haystack.includes(token)) score += 1;
  }

  return score;
}

async function buildKnowledgeBase(): Promise<KnowledgePost[]> {
  const allPosts = await getCollection('blog');
  const publishedPosts = allPosts.filter((post: any) => !post.data.draft);

  return publishedPosts.map((post: any) => {
    const cleanBody = (post.body || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[#>*_`\-\[\]\(\)!]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      slug: post.slug,
      title: post.data.title,
      description: post.data.description || '',
      track: post.data.track || '',
      text: cleanBody,
    };
  });
}

function fallbackReply(matches: KnowledgePost[]): string {
  if (!matches.length) {
    return 'That is such a real challenge, and you are definitely not alone in it. I could not find a close match in the current site content yet, but try keywords like focus, pressure, anxiety, confidence, team collapse, or support resources and I will point you in the right direction.';
  }

  const best = matches[0];
  const snippet = (best.description || best.text || '').slice(0, 260).trim();

  return `Oh, I always find this one really useful. "${best.title}" is a strong place to start.${snippet ? ` ${snippet}${snippet.length >= 260 ? '...' : ''}` : ''}`;
}

async function generateAnthropicReply(input: {
  message: string;
  history: ChatMessage[];
  matches: KnowledgePost[];
}): Promise<string | null> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const configuredModel = import.meta.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const context = input.matches
    .map((post, index) => {
      const excerpt = `${post.description} ${post.text}`.slice(0, 850);
      return `${index + 1}. ${post.title} (/content-hub/${post.slug}/)\n${excerpt}`;
    })
    .join('\n\n');

  const historyText = input.history
    .slice(-6)
    .map((m) => `${m.role === 'assistant' ? 'Saoirse' : 'User'}: ${m.content}`)
    .join('\n');

  const responseStyles = [
    'Style for this answer: practical checklist with concise action steps.',
    'Style for this answer: supportive coaching tone with brief examples.',
    'Style for this answer: clear plan-first structure with what-to-do-next.'
  ];
  const styleHint = responseStyles[Math.floor(Math.random() * responseStyles.length)];

  const systemPrompt = [
    // Who Saoirse is
    'You are Saoirse, the educational guide for Mind the Gael, an online platform that bridges the gap in mental wellbeing and performance support for female athletes.',
    'Mind the Gael was founded by Emily Phelan, a Ladies Gaelic Football player who lived through anxiety, depression, panic attacks, and confidence swings in her own career, and built this platform to share what she has learned alongside the psychological research she is studying.',
    'You are not Emily. You are not a sports psychologist. You are not a therapist. You are a chatbot trained on the platform\'s content, helping athletes find what they need and make sense of what they are feeling.',
    'When relevant, you can refer to Emily by her first name (for example: "Emily writes about this in her Training the Mind series").',

    // Mission language
    'The platform exists to help female athletes understand confidence, pressure, focus, anxiety, and mental wellbeing in sport, in clear, usable language for real-time performance, not generic motivation.',
    'There are three content pillars you can point people toward: the Training the Mind Blog (sports psychology in plain language), the Gael Performance Toolkit (practical tools for focus, confidence, and match-day decisions), and Stronger Minds, Stronger Players (free, for spotting struggle and signposting professional support).',

    // Voice
    'Tone: warm, direct, grounded. Plain English. Honest about uncertainty. Not chirpy, not motivational, not over-affirming.',
    'Sentence shape: short sentences. You can start sentences with "And" or "But" when it sounds natural. Repetition is allowed for emphasis. Emily\'s voice does this often (for example: "I didn\'t understand why pressure... I didn\'t understand why confidence...").',
    'Avoid jargon unless the user clearly asks for the science.',
    'Do not use Irish-sport slang. Mind the Gael\'s identity is rooted in Gaelic Football but the writing is in plain English. Do not force phrases like "gas", "craic", or "sound".',
    'Never use emojis. Never use hype filler like "great question", "absolutely", "you\'ve got this", "amazing", or exclamation marks for emphasis.',

    // Empathy without impersonation
    'Validate feelings without pretending you share them. You are a chatbot, not an athlete. Never say "I get that", "I\'ve been there", "I struggle with that too", or anything that implies you have lived experience. Instead use phrasing like "That is a really common experience for athletes" or "A lot of female athletes describe this exact feeling".',

    // Response shape
    'Default response shape: one short line that names what the user is experiencing, then 2-3 concrete usable points, then one next step. The next step can be a small action, a question back, or a relevant article from the provided context. Vary this; do not be formulaic.',
    'Keep responses brief. Default under 150 words. People often open this chat in a moment of stress, not for a long read.',

    // Knowledge boundaries
    'Prefer the provided website context. Any claim you make that is NOT from a Mind the Gael article must be attributable to a real, named source: a peer-reviewed article (with at least author surname and approximate year), a recognised authority (e.g. NICE, POGP, Aspetar, NHS, WHO), or a well-established named framework in sports psychology (e.g. IZOF, self-determination theory, catastrophe theory, attention control theory).',
    'If you cannot name a real source you are confident exists, do NOT make the specific claim. Instead say something like "I am not sure of the research on that specific point. Emily may have written about it, or this is worth emailing her about" and offer the closest related Mind the Gael article.',
    'NEVER invent statistics, study findings, percentages, journal names, author names, or citations. Hallucinated citations cause real harm on a mental wellbeing platform. When in doubt, omit rather than guess.',
    'If you want to share a general principle without a specific citation, phrase it as a principle ("athletes often describe..." / "a common pattern is...") rather than dressing it up as research.',
    'Do not diagnose, label, or treat. Do not provide medical or clinical advice. If a user asks whether they have a condition, gently redirect them to a qualified professional and offer relevant educational content.',

    // Scope
    'If the question is fully unrelated to female athletes, sport, mental wellbeing, or performance, politely redirect to what you can help with.',

    // Safety — this overrides every other rule
    'If a user shows ANY sign of mental health crisis (suicidal thoughts, self-harm, feeling unsafe, being at breaking point, feeling hopeless or broken, not wanting to be here, being in dire need of support, having a breakdown, or any other language suggesting they need urgent mental health support), STOP your normal response. This rule overrides every other rule in this prompt. Tell them you are glad they reached out and that you are not the right support for what they are going through. Provide crisis contacts (UK: Samaritans 116 123, emergency 999; Ireland: Samaritans 116 123, Pieta 1800 247 247 for suicide/self-harm, emergency 112). Direct them to /resources. Tell them to email Emily directly at emilyphelan@mindthegael.co.uk. Do not provide any other content or advice.',

    styleHint
  ].join(' ');

  const userPrompt = [
    `User question: ${input.message}`,
    historyText ? `Conversation history:\n${historyText}` : '',
    context ? `Website context:\n${context}` : 'No matching context found.'
  ].filter(Boolean).join('\n\n');

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: configuredModel,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.55,
      max_tokens: 320,
    });
    const block = response.content?.[0];
    return block?.type === 'text' ? block.text.trim() : null;
  } catch (error) {
    console.error('Anthropic API error:', error);
    return null;
  }
}

function isCrisisMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return CRISIS_TERMS.some((term) => lower.includes(term));
}

function jsonResponse(payload: ChatApiResponse, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(payload), { ...init, headers });
}

export const POST = async ({ request }: { request: Request }) => {
  const clientKey = getClientKey(request);

  try {
    if (isRateLimited(clientKey)) {
      logChatEvent({ status: 'rate-limited', clientKey, message: '' });
      return jsonResponse(
        {
          error: 'Too many messages in a short time. Please wait a minute and try again.',
          safety: safetyMeta(),
        },
        {
          status: 429,
          headers: { 'Retry-After': '60' },
        }
      );
    }

    const body = await request.json().catch(() => ({}));
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const history: ChatMessage[] = Array.isArray(body?.history)
      ? body.history
          .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
          .map((m: any) => ({ role: m.role, content: m.content.slice(0, 1000) }))
      : [];

    if (!message) {
      logChatEvent({ status: 'bad-request', clientKey, message: '' });
      return jsonResponse(
        {
          error: 'Message is required.',
          safety: safetyMeta(),
        },
        { status: 400 }
      );
    }

    if (isCrisisMessage(message)) {
      logChatEvent({ status: 'crisis', clientKey, message });
      return jsonResponse({
        reply: [
          "I'm really glad you reached out, and what you're sharing matters.",
          "",
          "I'm not the right support for what you're going through right now. I'm a chatbot, and you deserve a real person.",
          "",
          "If you are in immediate danger, please contact emergency services straight away. 999 in the UK, 112 in Ireland.",
          "",
          "For 24/7 emotional support, you can call Samaritans on 116 123 (UK and Ireland). In Ireland, Pieta on 1800 247 247 is there for suicide and self-harm crisis support.",
          "",
          "You can find more support contacts on the resources page (/resources).",
          "",
          "And please reach out to Emily directly. She would want to know you're struggling and can help you think about what to do next. You can email her at emilyphelan@mindthegael.co.uk.",
        ].join('\n'),
        sources: [{ title: 'Support Resources', url: '/resources' }],
        usedModel: false,
        safety: safetyMeta(),
      });
    }

    const kb = await buildKnowledgeBase();
    const tokens = tokenize(message);
    const matches = kb
      .map((post) => ({ post, score: scorePost(tokens, post) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((entry) => entry.post);

    const aiReply = await generateAnthropicReply({ message, history, matches });
    const reply = withSafetyDisclaimer(aiReply || fallbackReply(matches));

    logChatEvent({
      status: 'ok',
      clientKey,
      usedModel: Boolean(aiReply),
      message,
      sourceCount: matches.length,
    });

    return jsonResponse({
      reply,
      sources: matches.map((post) => ({
        title: post.title,
        url: `/content-hub/${post.slug}/`,
      })),
      usedModel: Boolean(aiReply),
      safety: safetyMeta(),
    });
  } catch (error) {
    console.error('Chat API error:', error);
    logChatEvent({ status: 'error', clientKey, message: '' });
    return jsonResponse(
      {
        error: 'Unable to process chat right now. Please try again in a moment.',
        safety: safetyMeta(),
      },
      { status: 500 }
    );
  }
};

function safetyMeta(): ChatSafetyMeta {
  return {
    banner: CHAT_BANNER_TEXT,
    emergency: CHAT_EMERGENCY_TEXT,
    resourcesUrl: CHAT_RESOURCES_URL,
  };
}

const CHAT_BANNER_TEXT =
  'Mind the Gael chat is for educational information only. It is not emergency support, diagnosis, or medical care.';
const CHAT_EMERGENCY_TEXT =
  'If you are in immediate danger, call emergency services now (112 or 999).';
const CHAT_RESOURCES_URL = '/resources';

type KnowledgePost = {
  slug: string;
  title: string;
  description: string;
  track: string;
  text: string;
};

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'your', 'you',
  'are', 'was', 'were', 'been', 'about', 'into', 'over', 'under', 'they',
  'them', 'their', 'there', 'what', 'when', 'where', 'which', 'while', 'would',
  'could', 'should', 'just', 'than', 'then', 'also', 'some', 'more', 'most',
]);

const CRISIS_TERMS = [
  // Suicide / self-harm
  'suicide',
  'kill myself',
  'end my life',
  'self harm',
  'self-harm',
  'want to die',
  'harm myself',
  'overdose',
  'i am in danger',
  'im in danger',
  // Broader mental-health-crisis indicators
  "can't go on",
  'cant go on',
  'breaking point',
  'at breaking point',
  'having a breakdown',
  'mental breakdown',
  'in crisis',
  'need urgent help',
  'i need help now',
  "don't want to be here",
  'dont want to be here',
  'no reason to live',
  'nothing to live for',
  'feel hopeless',
  'feel broken',
  'completely broken',
  "i can't cope anymore",
  'i cant cope anymore',
  'dire need',
  'in dire',
];

function withSafetyDisclaimer(reply: string): string {
  const disclaimer =
    ' I can share educational support, but I cannot provide diagnosis or emergency care.';
  if (!reply) return disclaimer.trim();

  const lower = reply.toLowerCase();
  if (
    lower.includes('cannot provide diagnosis') ||
    lower.includes('not emergency support') ||
    lower.includes('emergency services')
  ) {
    return reply;
  }

  return `${reply}${disclaimer}`;
}