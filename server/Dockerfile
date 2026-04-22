# === Stage 1: Build (install deps + compile native modules) ===
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ pkgconfig openssl pixman-dev cairo-dev pango-dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate Prisma client
RUN npx prisma generate

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

# === Stage 2: Runtime (no compilers, no -dev headers) ===
FROM node:20-alpine

RUN apk add --no-cache openssl pixman cairo pango giflib libjpeg-turbo \
    postgresql-client curl \
    chromium mesa-gl mesa-egl mesa-dri-gallium

WORKDIR /app

# Copy compiled node_modules from builder (includes native addons)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/occt-import-js.node.cjs ./occt-import-js.node.cjs
COPY --from=builder /app/static ./static
COPY --from=builder /app/VERSION ./VERSION

RUN mkdir -p uploads/.metadata uploads/chunks uploads/batch static/models static/thumbnails static/batch

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 8000

CMD ["sh", "-c", "npx prisma migrate deploy || true && node --import tsx src/cluster.ts"]
