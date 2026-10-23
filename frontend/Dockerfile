FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

# [Gate G2 v2] 以前は `COPY . .` で文脈を全部写していた。.dockerignore は .gitignore の対象で
# リポジトリに無く、omega-dev2 では手元の node_modules(試験のために手元で npm ci した、前の版の依存)が
# 上の npm ci で入れた物に上書きされ、依存の版が混ざって build が失敗した(Tailwind CSS 3 の
# tailwindcss が Tailwind CSS 4 の @import 'tailwindcss' に読まれた)。build に要る物だけを写す。
# .env* は以前と同じく Vite の設定(VITE_*)を読ませるため(無ければ何も写らない)。
COPY index.html vite.config.ts postcss.config.js tsconfig.json tsconfig.node.json .env* ./
COPY public ./public
COPY src ./src
COPY server ./server

# [Gate #8] VITE_API_URLはViteの静的ビルド時に import.meta.env として埋め込まれるため、
# コンテナ起動時のenvironment:では反映されない。docker-compose.ymlのbuild.args経由で
# ビルドARGとして正しく受け取る。
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npx vite build
# [Gate G3] DEP-03 本番用の配信(server/static-server.mjs)が使う応答ヘッダーの定義を、画面と同じ
# src/config/securityHeaders.ts から作る(依存のパッケージなしで動く ES module)
RUN npx esbuild src/config/securityHeaders.ts --format=esm --platform=node --target=node20 --outfile=server/securityHeaders.mjs

FROM node:24-alpine AS runtime

WORKDIR /app

# [Gate G3] DEP-03 以前の実行の段は `vite preview`(開発用の確認の道具)で配信し、node_modules(開発用の依存を含む)を
# 丸ごと入れていた。今は Node の標準の部品だけで動く配信(server/static-server.mjs)と build の結果(dist)だけを入れる。
# 応答ヘッダー(CSP 等)・受け付ける名前(TC_PUBLIC_HOSTS)・API の向き先は以前と同じ規則(src/config/securityHeaders.ts)。
# [Gate R2-6] root の持ち物のままだと USER node で読めないため、写す時に node の持ち物にする。
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server

ENV NODE_ENV=production
USER node

EXPOSE 4173

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:4173 || exit 1

CMD ["node", "server/static-server.mjs"]
