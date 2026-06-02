import fastify from 'fastify';

const app = fastify();

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
