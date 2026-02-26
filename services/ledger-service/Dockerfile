# Pin Node 22.12+ for Prisma 7 (requires 20.19+, 22.12+, or 24+)
FROM node:22.12-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22.12-bookworm-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated

ENV NODE_ENV=production

EXPOSE 4001

CMD ["npm", "start"]
