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

type KnowledgePost = {
  slug: string;
  title: string;
  description: string;
  track: string;
  text: string;
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'to', 'of', 'for', 'in', 'on', 'and', 'or', 'with', 'at', 'by', 'from',
  'this', 'that', 'it', 'as', 'be', 'can', 'i', 'you', 'we', 'my', 'your', 'our', 'about', 'what', 'how'
]);

const CRISIS_TERMS = [
  'suicidal', 'suicide', 'ending my life', 'end it all', 'cant go on', "can't go on",
  'i want to die', 'kill myself', 'self-harm', 'self harm', 'harm myself', 'end my life',
  'hurt myself', 'overdose', 'panic attack', 'severe anxiety', 'hopeless', 'want to die', 'emergency'
];

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

function fallbackReply(question: string, matches: KnowledgePost[]): string {
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
    'You are Saoirse, an educational chatbot for Mind the Gael.',
    'Personality: you are warm, grounded, encouraging, and clear, like a supportive teammate with strong psychological insight.',
    'Voice: plain English, practical, no jargon unless the user asks for deeper detail.',
    'Response style: 1 short empathy line when appropriate, then 2-4 actionable points, then a brief next step.',
    'Use personal, human phrasing like "I get that" or "I struggle with that sometimes too" where natural.',
    'Do not use the exact phrase "Based on your question".',
    'Use occasional gentle Irish-sport phrasing naturally, but do not overdo it or use slang every message.',
    'Only answer using the provided website context.',
    'If the context does not contain the answer, say you are not sure and suggest related articles.',
    'Do not provide diagnosis or medical advice. Keep tone warm, practical, and concise.',
    'If the user appears to be in immediate danger, advise contacting emergency services and the resources page.',
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

export const POST = async ({ request }: { request: Request }) => {
  const clientKey = getClientKey(request);

  try {
    if (isRateLimited(clientKey)) {
      logChatEvent({ status: 'rate-limited', clientKey, message: '' });
      return new Response(
        JSON.stringify({ error: 'Too many messages in a short time. Please wait a minute and try again.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
          },
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
      return new Response(JSON.stringify({ error: 'Message is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (isCrisisMessage(message)) {
      logChatEvent({ status: 'crisis', clientKey, message });
      return new Response(
        JSON.stringify({
          reply: 'I am really glad you reached out. If you are in immediate danger, call emergency services now (112 or 999). Please also go to /resources for crisis support contacts in the UK and Ireland.',
          sources: [{ title: 'Support Resources', url: '/resources' }],
          usedModel: false,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
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
    const reply = aiReply || fallbackReply(message, matches);

    logChatEvent({
      status: 'ok',
      clientKey,
      usedModel: Boolean(aiReply),
      message,
      sourceCount: matches.length,
    });

    return new Response(
      JSON.stringify({
        reply,
        sources: matches.map((post) => ({
          title: post.title,
          url: `/content-hub/${post.slug}/`,
        })),
        usedModel: Boolean(aiReply),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Chat API error:', error);
    logChatEvent({ status: 'error', clientKey, message: '' });
    return new Response(
      JSON.stringify({
        error: 'Unable to process chat right now. Please try again in a moment.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};