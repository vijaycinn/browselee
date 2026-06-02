import fastify from 'fastify';
import cors from '@fastify/cors';
import chatRoutes from './routes/chat.js';

const app = fastify();

// Register CORS middleware
await app.register(cors, { origin: true, methods: ['POST', 'GET'] });

// Register chat routes
await app.register(chatRoutes);

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
