# ADR: ログの個人情報・秘密の保護と自動検査(B-009)

- 状態: 採用(Gate O2、2026-10-17)
- 関連: DOC-10 §7 B-009、DOC-11(個人情報の最小化・ログの方針)、ADR-operations(O1 の運用コマンド)
- 実装: `backend/app/core/log_safety.py`、`backend/app/__init__.py`、`backend/app/core/database.py`、
  `backend/tests/conftest.py`・`tests/test_zz_log_leak_scan.py`、`tcops.py log-scan`

## 1. 背景(調査で分かったこと)

B-009 は「backend のログに個人情報が出ないことの自動検査が無い」だった。コードを調べた結果、検査が無いだけでなく、
実際に次の経路で出ていた。

| 経路 | 出ていたもの | 原因 |
|---|---|---|
| SQLAlchemy の echo | **全 SQL の値**(メールアドレス・パスワードのハッシュ・暗号文・位置・メモの本文・予約の内容) | `create_engine(echo=settings.DEBUG)`。omega-dev2 の `.env` は `DEBUG=true` |
| uvicorn のアクセスログ | 共有リンクのトークン(`/public/share/{token}/resolve`)、文書ダウンロードの署名トークン(`?token=`) | URL をそのまま記録 |
| ログイン(`AuthManager.authenticate_user`) | 存在しないアカウントへの入力メールアドレス | `f"User not found: {email or username}"` |
| メール通知 | 宛先・件名 | `f"Mock email sent to {to_email}: {subject}"` 等 |
| 外部検索の失敗 | 検索語(利用者の入力)と、それを含む URL | `logger.warning("... %r: %s", query, exc)` |
| PostgreSQL のエラー | 値(`DETAIL: Key (email)=(…)`、`invalid input syntax …: "…"`、`LINE 1: … '…'`) | `logger.exception` が DB エラーの文面を記録。`hide_parameters` では消えない |
| httpx(HTTP クライアント) | リクエスト URL(検索語・トークン) | ライブラリの INFO ログ |

なお `app/core/logging.py` の `setup_logging` はどこからも呼ばれておらず、実際の出力先は uvicorn の設定・
SQLAlchemy の echo・Python 既定の stderr(WARNING 以上)だった。

## 2. 決定

### 2.1 出口で伏せる(どの経路でも効く1か所)

- `logging.setLogRecordFactory` に伏せる処理を入れ、**記録を作る時点で**本文・引数・例外の文面を伏せる。
  ロガーごと・出力先ごとのフィルタと違い、uvicorn・SQLAlchemy・後から設定される出力先にも漏れなく効く。
  `app/__init__.py` で入れるので、backend のどのプロセス(uvicorn・試験・完全削除などのバッチ)にも効く。
- 伏せる種類: 接続文字列の資格情報、Bearer、URL の秘密のパラメータ(token・sig・code・password 等)、
  共有リンクのトークン(パス)、JWT、Fernet の暗号文、bcrypt のハッシュ、`password=…` 等の値、
  PostgreSQL のエラー文の値、メールアドレス。種類名(`<email>` 等)は残し、何が起きたかは読めるようにする。
- 数値の引数(`%d` 等で整形されるもの、Decimal を含む)は変えない。uvicorn のアクセスログの書式(引数の
  タプル)も壊さない(試験で確認)。冪等(何度かけても同じ)。
- URL を丸ごと INFO で出すライブラリ(httpx・httpcore・urllib3)は WARNING 以上だけにする。

### 2.2 出どころを直す

- SQL の echo は専用の `SQL_ECHO`(既定 off)に分け、`hide_parameters=True` を常に付ける(DB エラーの
  SQLAlchemy 側の文面からも値が消える)。`DEBUG` の意味は変えない。
- 上の表の個別の箇所を、値ではなく件数・型・ID だけを出すように直す。
- **静的検査**: `app/` のすべてのログ呼び出しについて、引数(f-string の中を含む)に email・password・token・
  secret・recipient・phone・query・address を表す名前の変数を渡していないことを試験で確かめる
  (`len()`・`type()` の中や、`_id`・`_type`・`_count` で終わる名前は許す)。

### 2.3 自動検査(B-009 の本体)

- **試験の全実行中**: `tests/conftest.py` が全ログ(DEBUG 以上)を受け取る検査用の出力先を付け、
  (a) 伏せる前の記録(出どころの不備をソースの「ファイル:行」で示す)と (b) 実際の出力の両方を検査する。
  試験中に発行・使用された秘密(`secrets.token_*` の出力、ハッシュ化・照合したパスワード、ダウンロードの
  トークン)を自動で登録し、形では判別できない値の漏れも見つける。最後に実行される
  `tests/test_zz_log_leak_scan.py` が1件でもあれば失敗にする(CI の pytest で blocking)。
- **実際のコンテナ**: `tcops.py log-scan` が `docker compose logs` を同じ規則で検査する。パッチは E2E の後に
  backend コンテナのログを、E2E が使うパスワードも照合して検査し、1件でもあれば適用しない。
  毎日 03:50 に定期実行し、結果を監視(`log_leak`)に載せる。見つけた値そのものは表示・保存しない。

## 3. 採らなかった案

| 案 | 理由 |
|---|---|
| ロガー・出力先ごとの `logging.Filter` | uvicorn が設定する出力先、後から追加される出力先、Python 既定の stderr に付け忘れが起きる。記録の工場なら1か所 |
| 構造化ログ(JSON)へ全面移行 | 変更範囲が大きい。伏せる処理は形式によらず必要で、移行は別 Gate |
| 電話番号・住所・氏名の形での検出 | 誤検出が多く、伏せすぎでログが読めなくなる。出どころの静的検査と既知の秘密の照合で補う |
| SQL の echo をやめるだけ | DB エラーの文面・他の経路の漏れが残る。検査が無ければ再発する |

## 4. 制約・未実装

- 自由記述(メモの本文・予定名)のような、形で判別できない個人情報は出口では伏せられない。出どころの静的検査と、
  試験・E2E での既知の値の照合で防ぐ。
- 既に omega-dev2 の backend コンテナのログに残っている過去の値は、パッチがコンテナを作り直すことで消える
  (docker のログはコンテナごと)。ホストへ別に保存したログがあれば手で消す。
- frontend(ブラウザの console)は A1 で対処済み(E2E で検査)。nginx 等の前段は未導入。
