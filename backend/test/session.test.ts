import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import sessionRoutes from '../src/routes/session.js';
import { setAiAzureTokenForTesting, resetCredentialForTesting } from '../src/foundry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch as AnyFetch | undefined;

function makeMockFetch(responseData: unknown, status = 200): AnyFetch {
  return async (_url, _init) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseData,
      text: async () => JSON.stringify(responseData),
    }) as unknown as Response;
}

let app: ReturnType<typeof Fastify>;

before(async () => {
  process.env.FOUNDRY_ENDPOINT = 'https://smec-poc-vcinn-resource.services.ai.azure.com';
  resetCredentialForTesting();
  setAiAzureTokenForTesting('fake-ai-azure-token');

  app = Fastify({ logger: false });
  // Register rate-limit so per-route config in session.ts resolves without error
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
  await app.register(sessionRoutes);
  await app.ready();
});

after(async () => {
  if (originalFetch) {
    (globalThis as Record<string, unknown>).fetch = originalFetch;
  }
  await app.close();
});

test('POST /api/session returns correct shape on success', async () => {
  (globalThis as Record<string, unknown>).fetch = makeMockFetch({
    data: { value: 'sk-eph-test', expires_at: 1234 },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: {},
  });

  assert.equal(response.statusCode, 200, `Expected 200, got ${response.statusCode}: ${response.body}`);
  const body = JSON.parse(response.body);
  assert.equal(body.clientSecret, 'sk-eph-test');
  assert.equal(body.expiresAt, 1234);
  assert.ok(
    body.webrtcCallsUrl.includes('?webrtcfilter=on'),
    `webrtcCallsUrl should contain ?webrtcfilter=on, got: ${body.webrtcCallsUrl}`,
  );
  assert.equal(body.model, 'gpt-realtime-mini');
  assert.ok(
    body.webrtcCallsUrl.includes('smec-poc-vcinn-resource.openai.azure.com'),
    `webrtcCallsUrl should use .openai.azure.com host, got: ${body.webrtcCallsUrl}`,
  );
  console.log('✓ /api/session success shape verified');
});

test('POST /api/session with voice and instructions forwards them', async () => {
  let capturedBody: unknown;
  (globalThis as Record<string, unknown>).fetch = async (_url: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { value: 'sk-eph-test2', expires_at: 5678 } }),
      text: async () => '',
    } as unknown as Response;
  };

  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { voice: 'coral', instructions: 'Be a helpful assistant' },
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.clientSecret, 'sk-eph-test2');
  assert.equal(body.expiresAt, 5678);

  const session = (capturedBody as { session: Record<string, unknown> }).session;
  assert.equal(session.instructions, 'Be a helpful assistant');
  assert.equal((session.audio as { output: { voice: string } }).output.voice, 'coral');
  console.log('✓ /api/session voice + instructions forwarded correctly');
});

test('POST /api/session returns 502 on Foundry 401', async () => {
  (globalThis as Record<string, unknown>).fetch = makeMockFetch(
    { error: 'Unauthorized', message: 'invalid token' },
    401,
  );

  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: {},
  });

  assert.equal(response.statusCode, 502, `Expected 502, got ${response.statusCode}`);
  const body = JSON.parse(response.body);
  assert.equal(body.error, 'foundry_session_failed');
  console.log('✓ /api/session 502 on Foundry 401 verified');
});

test('POST /api/session returns 400 on invalid voice', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { voice: 'invalid-voice-name' },
  });

  assert.equal(response.statusCode, 400, `Expected 400, got ${response.statusCode}`);
  const body = JSON.parse(response.body);
  assert.equal(body.error, 'invalid_request');
  console.log('✓ /api/session 400 on invalid voice verified');
});
