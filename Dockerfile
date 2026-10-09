# syntax=docker/dockerfile:1
# CloseLoop app image: Next.js standalone server, non-root, port 3000.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# pnpm version comes from package.json "packageManager".
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install && pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build without secrets: every route that touches ClickHouse is dynamic (connection()).
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Imported by src/lib/lab.ts; copied explicitly in case tracing ever drops it.
COPY --from=build --chown=nextjs:nodejs /app/lab/api/server.mjs ./lab/api/server.mjs
# src/lib/store.ts writes run state under <cwd>/.closeloop-data.
RUN mkdir -p .closeloop-data && chown nextjs:nodejs .closeloop-data
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
