# Wayfarer — geotagged photos → interactive travel map.
# All dependencies are pure JS / WebAssembly (exifr, heic-convert via libheif),
# so a slim Node image works with no native build toolchain.
FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source (test/ and dev files are excluded via .dockerignore).
COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV PORT=4747
EXPOSE 4747

CMD ["node", "server.js"]
