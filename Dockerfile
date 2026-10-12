# syntax=docker/dockerfile:1
# Tessera container (ADR-004). Debian 13 slim, glibc, runs as the non-root "node" user.
# better-sqlite3 ships prebuilt binaries for linux x64 and arm64, so no compiler is needed.

FROM node:24-trixie-slim AS build
WORKDIR /app

# Dependencies first so this layer is cached until the lockfile changes.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim AS runtime

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Tessera" \
      org.opencontainers.image.description="Self-hosted flashcards that Claude can write for you." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

# BODY_SIZE_LIMIT: adapter-node rejects bodies over 512K by default, below the 5 MB import limit.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    BODY_SIZE_LIMIT=5M

WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/drizzle ./drizzle

# The server runs with node alone. The base image also carries npm, corepack, and yarn, each with its own copies of
# packages (tar, brace-expansion, ip-address, undici and others) that this app never loads. They are the source of
# the vulnerability scan's findings in the image, and nothing here uses them: the health check and the start command
# are node. Removing them shrinks the image and leaves less to patch. The build stage still has npm.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* /root/.npm

# Owned by node so a named volume inherits the right owner on first use.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000

# The slim image has no curl, so the check uses Node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run with an init process (docker run --init, or init: true in compose) so signals and zombies are handled.
CMD ["node", "build/index.js"]
