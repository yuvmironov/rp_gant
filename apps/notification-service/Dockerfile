FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/service-kit/package.json packages/service-kit/
COPY apps/notification-service/package.json apps/notification-service/

RUN pnpm install --frozen-lockfile --prod

FROM node:22-alpine AS runtime

RUN addgroup -g 10001 -S app && adduser -u 10001 -S -G app app
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=app:app packages ./packages
COPY --chown=app:app apps ./apps
COPY --chown=app:app proto ./proto
COPY --from=deps --chown=app:app /app/packages/service-kit/node_modules ./packages/service-kit/node_modules
COPY --from=deps --chown=app:app /app/apps/notification-service/node_modules ./apps/notification-service/node_modules

USER 10001
EXPOSE 8080 50052

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health/live >/dev/null || exit 1

CMD ["node", "apps/notification-service/src/index.js"]
