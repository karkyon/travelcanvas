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
# [Gate S2] `vite preview` が応答にセキュリティヘッダー(CSP 等)を付けるのは vite.config.ts の preview.headers。
# 以前は実行用の段に vite.config.ts を入れておらず、設定なしで動いていた(ヘッダーが付かない)。
# 設定が読む src/config/securityHeaders.ts も入れる。vite は設定を読む時に同じ場所へ一時ファイルを書くため、
# /app を node の持ち物にする(root のままだと EACCES で起動しない)。
COPY --from=build --chown=node:node /app/vite.config.ts ./vite.config.ts
COPY --from=build --chown=node:node /app/src/config ./src/config
RUN chown node:node /app

USER node

EXPOSE 4173

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:4173 || exit 1

CMD ["npm", "run", "preview"]
