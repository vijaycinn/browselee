FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile=false --prod=false
COPY tsconfig*.json ./
COPY src ./src
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY package.json ./
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]
