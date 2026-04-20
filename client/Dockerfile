FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Pre-compress static assets for gzip_static
RUN find /app/dist -type f \( -name "*.js" -o -name "*.css" -o -name "*.html" -o -name "*.svg" -o -name "*.json" \) \
    -exec gzip -k -9 {} \;

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
