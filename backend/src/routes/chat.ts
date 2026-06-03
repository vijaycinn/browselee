import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { buildOpenAIClient } from '../foundry.js';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema),
  context: z.string().optional(),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;

const REFUSAL = 'Not on this page.';

const STRICT_GROUNDING_POLICY = [
  'You are Browselee — a page-reading assistant. You answer questions about the web page the user is currently viewing.',
  '',
  'CONTEXT FORMAT:',
  '- `# ABOUT THIS PAGE` — page metadata (Site, Title, Description, Topics, URL).',
  '- `## HEADLINES ON THIS PAGE` — visible headlines/links on the page.',
  '- `## PAGE CONTENT` / `# CURRENT PAGE` — article body markdown.',
  '- `# LINKED PAGES` — content from pages reachable in 1 hop from the current page.',
  '',
  'INTENT MATCHING — BE GENEROUS:',
  '- The user is looking at this page RIGHT NOW. Assume their question relates to it unless clearly impossible.',
  '- "tell me about X", "what is X", "details on X", "what do you know about X" → Summarize what the page says about X. If X matches the page topic itself (site name, title, description), give a page summary.',
  '- Synonyms count: "garbage pickup" = "collection calendar"; "cost" = "price"; "hours" = "schedule"; abbreviations like "sac" = "Sacramento".',
  '- Vague questions ("what is this page about?", "summarize", "tell me more") → Summarize the page title, description, and main headlines.',
  '- If the question COULD be answered from the page content — answer it. Only refuse when the topic is clearly unrelated (e.g. sports scores on a city utilities page).',
  '',
  'ANSWERING RULES:',
  '1) Answer ONLY from the corpus. Never invent facts or use outside knowledge.',
  `2) If the topic is clearly unrelated to everything in the corpus, reply: "${REFUSAL}"`,
  '3) For "headlines" / "news" / "what\'s on this page" → list headline items as bullets.',
  '4) Quote names, dates, URLs verbatim from the corpus.',
  '5) Never ask clarifying questions. If multiple items match, list them all.',
  '6) Never say you are an AI or explain how you work.',
  '7) Style: short and concrete. Max 4 sentences OR up to 8 bullet items. No filler.',
].join('\n');

async function chatHandler(request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) {
  const requestId = request.id || crypto.randomUUID?.() || `req-${Date.now()}`;

  try {
    // Validate request body
    const body = ChatRequestSchema.parse(request.body);

    // Build message array with strict grounding policy
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    messages.push({ role: 'system', content: STRICT_GROUNDING_POLICY });

    if (body.context) {
      const contextMessage = `Page context (markdown):\n\n${body.context.slice(0, 60000)}`;
      messages.push({ role: 'system', content: contextMessage });
    } else {
      messages.push({
        role: 'system',
        content:
          'No page context is available for this turn. You must return the exact refusal string from policy.',
      });
    }

    messages.push(...body.messages);

    // Set SSE response headers
    reply.header('Content-Type', 'text/event-stream');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');
    reply.header('X-Accel-Buffering', 'no');

    // Build OpenAI client
    const client = await buildOpenAIClient();
    const modelName = process.env.FOUNDRY_TEXT_MODEL || 'gpt-4o-mini';

    // Create streaming chat completion
    const stream = await client.chat.completions.create({
      model: modelName,
      messages: messages,
      temperature: 0.4,
      stream: true,
    });

    // Stream response as SSE
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      reply.raw.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }

    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
  } catch (error) {
    let errorMessage = 'Unknown error';

    if (error instanceof z.ZodError) {
      errorMessage = `Validation error: ${error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }

    console.error(`[${requestId}] Chat error:`, errorMessage, error);

    reply.raw.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    reply.raw.end();
  }
}

export default async function (app: FastifyInstance) {
  app.post<{ Body: ChatRequest }>('/api/chat', chatHandler);
}
