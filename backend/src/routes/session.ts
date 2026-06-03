import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getAiAzureToken, getRealtimeBaseUrl } from '../foundry.js';

const SessionRequestSchema = z.object({
  instructions: z.string().max(32000).optional(),
  voice: z
    .enum(['alloy', 'ash', 'ballad', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse'])
    .optional(),
});

type SessionRequest = z.infer<typeof SessionRequestSchema>;

async function sessionHandler(request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) {
  const requestId = request.id || `req-${Date.now()}`;

  let body: SessionRequest;
  try {
    body = SessionRequestSchema.parse(request.body ?? {});
  } catch (err) {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'invalid_request', detail: err.issues });
    }
    throw err;
  }

  const model = process.env.FOUNDRY_REALTIME_MODEL || 'gpt-realtime-mini';
  const voice = body.voice ?? 'alloy';

  const sessionPayload = {
    session: {
      type: 'realtime',
      model,
      output_modalities: ['audio'],
      audio: { output: { voice } },
      ...(body.instructions ? { instructions: body.instructions } : {}),
    },
  };

  let token: string;
  try {
    token = await getAiAzureToken();
  } catch (err) {
    console.error(`[${requestId}] Failed to acquire ai.azure.com token:`, err);
    return reply.status(503).send({ error: 'token_acquisition_failed' });
  }

  let realtimeBaseUrl: string;
  try {
    realtimeBaseUrl = getRealtimeBaseUrl();
  } catch (err) {
    console.error(`[${requestId}] Invalid realtime endpoint configuration:`, err);
    return reply.status(503).send({ error: 'invalid_realtime_endpoint_config' });
  }

  const url = `${realtimeBaseUrl}/openai/v1/realtime/client_secrets`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // ai.azure.com scope token — NOT cognitiveservices. api-version must be omitted (causes 401 if present).
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(sessionPayload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      `[${requestId}] Foundry session fetch failed:`,
      isTimeout ? 'timeout after 10s' : err,
    );
    return reply.status(502).send({ error: isTimeout ? 'foundry_timeout' : 'foundry_unreachable' });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text().catch(() => '<unreadable>');
    }
    console.error(`[${requestId}] Foundry session failed: HTTP ${response.status}`, detail);
    return reply.status(502).send({ error: 'foundry_session_failed', detail });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    console.error(`[${requestId}] Failed to parse Foundry response:`, err);
    return reply.status(502).send({ error: 'foundry_invalid_response' });
  }

  const payload = (json as Record<string, unknown>) ?? {};

  // Compatibility: Foundry may return either
  // 1) { data: { value: "<ephemeral_token>", expires_at?: number } }
  // 2) { value: "<ephemeral_token>", expires_at?: number, session?: {...} }
  const data = payload.data as Record<string, unknown> | undefined;
  const clientSecret =
    (typeof data?.value === 'string' ? data.value : undefined) ??
    (typeof payload.value === 'string' ? payload.value : undefined);
  const expiresAt =
    (typeof data?.expires_at === 'number' ? data.expires_at : undefined) ??
    (typeof payload.expires_at === 'number' ? payload.expires_at : undefined) ??
    null;

  if (!clientSecret) {
    console.error(`[${requestId}] Foundry response missing data.value — raw:`, json);
    return reply.status(502).send({ error: 'foundry_missing_token' });
  }

  // Never log the ephemeral token value
  return reply.status(200).send({
    clientSecret,
    expiresAt,
    webrtcCallsUrl: `${realtimeBaseUrl}/openai/v1/realtime/calls?webrtcfilter=on`,
    model,
  });
}

export default async function (app: FastifyInstance) {
  app.post<{ Body: SessionRequest }>(
    '/api/session',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    sessionHandler,
  );
}
