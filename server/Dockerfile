# === Stage 1: Build (install deps + compile native modules) ===
FROM node:20-alpine AS builder

RUN apk update && apk add --no-cache python3 make g++ pkgconfig openssl pixman-dev cairo-dev pango-dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate Prisma client
RUN npx prisma generate

# Compile TypeScript for production runtime
RUN npm run build

# Copy Three.js to static/js/ for thumbnail renderer
RUN mkdir -p /app/static/js/addons && \
    cp node_modules/three/build/three.module.js /app/static/js/ && \
    cp node_modules/three/build/three.core.js /app/static/js/ && \
    cp -r node_modules/three/examples/jsm/loaders /app/static/js/addons/ && \
    cp -r node_modules/three/examples/jsm/environments /app/static/js/addons/ && \
    cp -r node_modules/three/examples/jsm/utils /app/static/js/addons/

# Inject version from git tag (fall back to "dev")
ARG APP_VERSION=dev
RUN echo $APP_VERSION > /app/VERSION

# Drop build-only dependencies after compilation.
RUN npm prune --omit=dev

# === Stage 2: Runtime (no compilers, no -dev headers) ===
FROM node:20-alpine

RUN apk update && apk add --no-cache openssl pixman cairo pango giflib libjpeg-turbo \
    postgresql-client curl \
    chromium mesa-gl mesa-egl mesa-dri-gallium

WORKDIR /app

# Copy production runtime files.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/occt-import-js.node.cjs ./occt-import-js.node.cjs
COPY --from=builder --chown=node:node /app/static ./static
COPY --from=builder --chown=node:node /app/VERSION ./VERSION

RUN mkdir -p uploads/.metadata uploads/chunks uploads/batch static/models static/thumbnails static/batch static/backups && \
    chown -R node:node /app/uploads /app/static

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 8000

USER node

CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/cluster.js"]
