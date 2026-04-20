FROM node:20-alpine

RUN apk add --no-cache python3 make g++ pkgconfig openssl \
    pixman-dev cairo-dev pango-dev giflib-dev libjpeg-turbo-dev \
    pixman cairo pango giflib libjpeg-turbo \
    chromium mesa-gl mesa-egl mesa-dri-gallium \
    postgresql-client

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Copy Three.js to static/js/ for thumbnail renderer
RUN mkdir -p /app/static/js/addons && \
    cp node_modules/three/build/three.module.js /app/static/js/ && \
    cp node_modules/three/build/three.core.js /app/static/js/ && \
    cp -r node_modules/three/examples/jsm/loaders /app/static/js/addons/ && \
    cp -r node_modules/three/examples/jsm/environments /app/static/js/addons/ && \
    cp -r node_modules/three/examples/jsm/utils /app/static/js/addons/

COPY . .

# Generate Prisma client
RUN npx prisma generate

RUN mkdir -p uploads/.metadata uploads/chunks uploads/batch static/models static/thumbnails static/batch

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 8000

CMD ["sh", "-c", "npx prisma migrate deploy && node --import tsx src/cluster.ts"]
