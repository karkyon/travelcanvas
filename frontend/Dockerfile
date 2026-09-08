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

# [Gate R2-6] 以前はここで`--chown`を指定しておらずCOPY --from=buildが
# root:rootで全ファイルをコピーしていた。直後のUSER nodeでnode(uid 1000)
# ユーザーへ切り替えると、root所有のツリーを`npm run preview`(package.json
# 読込)が読めずEACCES: permission deniedでコンテナが起動不能になっていた
# (`docker compose up -d --build`でfrontendコンテナを実際に再作成した際に
# 初めて顕在化。以前のGate検証はtsc/build/vitestのみでフルスタック起動を
# 伴わなかったため未発見だった)。COPY時点でnode:nodeへ所有権を渡すことで
# 解消する。
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules

USER node

EXPOSE 4173

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:4173 || exit 1

CMD ["npm", "run", "preview"]
