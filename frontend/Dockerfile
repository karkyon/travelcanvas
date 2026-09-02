FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# [Gate #8] VITE_API_URLはViteの静的ビルド時に import.meta.env として埋め込まれるため、
# コンテナ起動時のenvironment:では反映されない。docker-compose.ymlのbuild.args経由で
# ビルドARGとして正しく受け取る。
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npx vite build

FROM node:24-alpine AS runtime

WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

USER node

EXPOSE 4173

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:4173 || exit 1

CMD ["npm", "run", "preview"]
