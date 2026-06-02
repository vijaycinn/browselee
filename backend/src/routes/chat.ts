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

async function chatHandler(request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) {
  const requestId = request.id || crypto.randomUUID?.() || `req-${Date.now()}`;

  try {
    // Validate request body
    const body = ChatRequestSchema.parse(request.body);

    // Build message array, prepending context as system message if provided
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    if (body.context) {
      const contextMessage = `Page context (markdown):\n\n${body.context.slice(0, 60000)}`;
      messages.push({ role: 'system', content: contextMessage });
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
