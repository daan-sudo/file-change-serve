FROM node:20-bookworm-slim AS build-stage

WORKDIR /app

COPY package*.json ./

RUN npm config set registry https://registry.npmmirror.com/ \
  && npm ci

COPY . .

RUN npm run build

FROM node:20-bookworm-slim AS production-stage

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice \
    fonts-noto-cjk \
    fontconfig \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm config set registry https://registry.npmmirror.com/ \
  && npm ci --omit=dev

COPY --from=build-stage /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=4005
ENV LIBREOFFICE_PATH=/usr/bin/libreoffice

EXPOSE 4005

CMD ["node", "dist/main.js"]
