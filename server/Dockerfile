# === Stage 1: Build dependencies ===
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ pkgconfig openssl pixman-dev cairo-dev pango-dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate Prisma client
RUN npx prisma generate

# === Stage 2: Runtime ===
FROM node:20-alpine

# Only runtime libs (no -dev packages)
RUN apk add --no-cache openssl pixman cairo pango giflib libjpeg-turbo \
    postgresql-client git curl \
    chromium mesa-gl mesa-egl mesa-dri-gallium

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Copy built artifacts from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/occt-import-js.node.cjs ./occt-import-js.node.cjs
COPY --from=builder /app/static ./static

# Copy Three.js to static/js/ for thumbnail renderer
RUN mkdir -p /app/static/js/addons && \
    cp node_modules/three/build/three.module.js /app/static/js/ && \
    cp node_modules/three/build/three.core.js /app/static/js/ && \
    cp -r node_modules/three/examples/jsm/loaders /app/static/js/addons/ && \
    cp -r node_modules/three/examples/jsm/environments /app/static/js/addons/ && \
    cp -r node_modules/three/examples/jsm/utils /app/static/js/addons/

RUN mkdir -p uploads/.metadata uploads/chunks uploads/batch static/models static/thumbnails static/batch

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install docker-compose for in-container update feature
RUN ARCH=$(uname -m) && \
    curl -L "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-linux-${ARCH}" \
    -o /usr/local/bin/docker-compose && \
    chmod +x /usr/local/bin/docker-compose

EXPOSE 8000

CMD ["sh", "-c", "npx prisma migrate deploy || true && node --import tsx src/cluster.ts"]
