# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base

# ---- deps ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Node sizes its default heap off physical RAM only, ignoring swap — on a
# small VPS (under ~1-2GB RAM) that default lands well under what's actually
# available once swap is counted, and `next build` dies with an "Ineffective
# mark-compacts near heap limit" OOM despite swap sitting mostly unused.
# Override explicitly so it can use the headroom harden.sh's swapfile
# provides. Bump via --build-arg / BUILD_MAX_OLD_SPACE_MB in .env if a given
# box still runs out.
ARG BUILD_MAX_OLD_SPACE_MB=1536
ENV NODE_OPTIONS=--max-old-space-size=${BUILD_MAX_OLD_SPACE_MB}
RUN npm run build

# ---- runtime ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
# migrate.mjs runs as a plain Node script (not webpacked like the app
# itself), so its two dependency-free deps need to physically exist here.
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps /app/node_modules/postgres ./node_modules/postgres
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["./docker-entrypoint.sh"]
