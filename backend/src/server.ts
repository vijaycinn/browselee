import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import chatRoutes from './routes/chat.js';
import sessionRoutes from './routes/session.js';

loadEnv();
if (!process.env.FOUNDRY_ENDPOINT) {
  loadEnv({ path: resolve(process.cwd(), '..', '.env') });
}

const app = fastify();

// Register CORS middleware
await app.register(cors, { origin: true, methods: ['POST', 'GET'] });

// Global rate-limit (60 req/min per IP); /api/session overrides to 30 req/min via route config
await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });

// Register chat routes
await app.register(chatRoutes);

// Register session (Realtime ephemeral token) routes
await app.register(sessionRoutes);

app.get('/healthz', async () => {
  return { ok: true };
});

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';

app.listen({ port: PORT, host: HOST }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at http://${HOST}:${PORT}`);
});

export default app;
