FROM oven/bun:1@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json vite.config.ts index.html characters.html models.html environment.html ./
COPY src ./src
COPY public ./public
RUN bun run build

FROM oven/bun:1@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS production
ARG SOURCE_COMMIT=unknown
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
ENV ACCOUNT_DB_PATH=/app/data/accounts.sqlite APP_ORIGINS=https://game.delopusk.ru,https://game.balkhaev.com
ENV LIVE_DB_PATH=/app/data/live.sqlite
ENV GAME_DB_PATH=/app/data/game.sqlite
RUN mkdir -p /app/data && chown bun:bun /app/data && chmod 700 /app/data
COPY --from=build /app/dist ./dist
COPY --from=dependencies /app/node_modules ./node_modules
COPY server.ts ./
COPY server ./server
COPY src/game-save.ts src/raid-field.ts ./src/
COPY src/game ./src/game
USER bun
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["bun", "server.ts"]
