# ADR: セキュリティ基盤の仕上げ(Gate S1: CI の復旧・ログ保護・依存の脆弱性)

- 状態: 採用(Gate S1)
- 前提: Gate K1 適用後
- 関連: セキュリティ整理(2026-10-17)SEC-00・SEC-01・SEC-23、監査 F01〜F04、ADR-log-safety(O2)
- トレーサビリティ: `docs/trace/gate-s1-trace.md`

## 1. 背景

AI を使った攻撃は、公開された脆弱性が出てから短時間で無差別・連続に試される。守りの前提として、
(1) 変更のたびに機械で止める仕組み(CI)が動いていること、(2) 侵入された時にログから秘密が漏れないこと、
(3) 既知の脆弱性を持つ部品を本番に載せないこと、の3つが要る。調査時点では次の状態だった。

- CI が秘密情報の検査で止まり、backend・frontend・E2E の試験が全て skipped(試験用の接続文字列5件の誤検知)。
- 検査は行のどこかに `example` や `<` があれば行全体を除外しており、同じ行の本物の資格情報を見逃し得た。
- ログ保護(O2)の抜け: extra=… の値(F02)、構造化ログでの例外の作り直し(F03)、`password=%s` での整形失敗と
  stderr への生の引数(F04)。
- backend の依存に既知の脆弱性が20パッケージ超(FastAPI・Starlette・python-multipart・python-jose・Pillow・
  cryptography・aiohttp・transformers 等)。多くはアプリが import していない部品だった。
- frontend の依存に既知の脆弱性45件(ブラウザへ届く axios・react-router を含む)。

## 2. 決定

### 2.1 CI
- 試験用の接続文字列は `dummy-` を付けた値にする(検査の除外はしない)。
- 検査は「一致した文字列そのもの」にダミーの印があるときだけ除外する。自己試験(`--self-test`)を CI で実行。
- 依存の検査ジョブ `dependency-audit` を追加(blocking)。

### 2.2 ログ
- 記録の工場で、本文と引数を**先に整形してから**伏せ、引数を空にする。整形できない記録は引数を捨てて印を付ける
  (stderr に生の引数を出さない)。`uvicorn.access` は引数を前提に整形するため、引数を1つずつ伏せる従来の方式。
- `Logger.makeRecord` を包み、extra=… で付く属性も伏せる。dict・list は入れ子までたどり、キー名が秘密を表すもの
  (password・token・api_key・pin・session_id 等。単語単位で判定し、mapping 等は当たらない)は値を丸ごと伏せる。
- 構造化ログのフォーマッターは、伏せた例外(型・本文・トレースバック)だけを使い、extra は基本の項目を上書き
  させない。出力の最後にもう一度伏せる。
- 試験中の全ログ検査(LeakCollector)は extra の属性も検査する。

### 2.3 依存
- backend: `requirements.txt` を「アプリが import するもの」だけにし、推移的な依存まで版を固定。
  試験・lint・監査の道具は `requirements-dev.txt`(Dockerfile の開発ステージも版を固定して入れる)。
- 上げたもの: FastAPI 0.143 / Starlette 1.8 / python-multipart 0.0.32 / Pillow 13 / cryptography 50 / Jinja2 3.1.6 /
  uvicorn 0.54 / gunicorn 26 / pydantic 2.14 ほか。据え置き: SQLAlchemy 2.0.23、alembic 1.12.1、redis 5.0.1、
  bcrypt 4.0.1(passlib 互換)。
- **JWT は python-jose から PyJWT へ**(python-jose は保守停止で、修正版の無い HS256 偽造の脆弱性と、
  修正予定の無い ecdsa の依存があった)。`JWT_ALGORITHM` は HS256/384/512 だけを許す。
- 新しい FastAPI は取り込んだルーターを `app.routes` に展開しないため、ルートの列挙は `app/core/route_index.py`
  を通す(/ready の必須ルーター確認、/metrics のルートの型、CORS の試験)。
- frontend: axios 1.20.0、react-router-dom 6.30.6、postcss 8.5.30、`npm audit fix`(メジャー更新なし)。
- 検査は `scripts/security/audit_deps.py`。例外は `scripts/security/dependency-allowlist.json` に、助言の ID・範囲
  (build-only / test-only / not-reachable)・理由・期限を書く。期限切れ、またはブラウザへ届く依存に build-only の
  例外を付けたものは失敗。
- react-router v6 の2件(SSR の deserializeErrors、バックスラッシュによる外部移動)は、SSR 不使用・利用者の入力を
  移動先にしない・サーバー由来の移動先は `utils/safeNavigation.ts` で拒否する、の3点で到達しないため例外にする。

## 3. 残すもの(期限 2026-12-31 の例外)

- vite 4(開発サーバーの問題。本番の配信を `vite preview` から静的配信へ移す。SEC-D)、tailwindcss 3 系、
  vitest 0.34(UI サーバーを使う時だけの問題)、react-router v7 への移行。いずれもメジャー更新で別 Gate。
- main ブランチの保護(必須 CI・直接 push の禁止)は GitHub の設定で行う(このリポジトリの変更では設定できない)。
