# Gate SecretPolicy 受入手順(omega-dev2 / 192.168.1.11)

対象: PR「Gate SecretPolicy」「Gate ProviderConnect」を main へ入れた後の LAN 受入。
**migration が 1つある**(`b7e3c9d1f5a2`: 鍵の確認の列・確認の記録の表。既存の鍵は消さず unverified のまま)。
秘密の値・`.env` の中身・`docker compose config` の展開結果は、表示も貼り付けもしない。

## 0-a. 事前の注意
- **`SECRET_BACKEND` は未設定だと鍵を取得も送信もしない**(既定の保管先は無い)。開発・LAN 受入で暫定の DB 暗号化を使う時だけ、`.env` に非秘密の 1 行 `SECRET_BACKEND=db_encrypted` を足す(値の中身は他の項目と一緒に貼らない)。
- 作業ツリーに未追跡の `gate_secretpolicy.patch` があれば、古い成果物なのでリポジトリの外へ移す(`mv gate_secretpolicy.patch ~/`)。clean の確認が通らなくなる。
- `/ready` が 503 で `migration_current` が false の時は、コードの migration(FR059 の `a1d3f5b7c9e2`)に DB が追いついていないだけ(backend は `./backend:/app` を共有しているため、`git pull` だけで先にコードが変わる)。`docker compose up -d --build` の `migrate` が `alembic upgrade head` を実行して解消する。

## 0. 反映前(必ず)
```bash
cd ~/projects/travelcanvas
git status --short --branch          # dirty なら停止。内容を確認して日時付きの別の場所へ退避してから
git rev-parse HEAD
docker compose ps -a
docker compose exec -T backend alembic current
curl -fsS http://127.0.0.1:8001/health; curl -fsS http://127.0.0.1:8001/ready
```
- `git reset --hard` / `git clean` / `docker compose down -v` / volume 削除はしない。
- 既存の鍵(provider_secrets)を壊さないため、反映前に DB のバックアップを取る(既存の手順に従う)。`ENCRYPTION_KEY` は変えない。

## 1. 反映(main へ入った確定 SHA で)
```bash
git fetch origin && git checkout main && git pull --ff-only
git rev-parse HEAD                    # PR の merge commit と一致を確認
docker compose up -d --build          # migrate サービスが alembic upgrade head を実行する
docker compose ps -a                   # migrate が Exited (0)
docker compose exec -T backend alembic current   # b7e3c9d1f5a2 (head)
```

## 2. 確認(値は出さない)
```bash
docker compose ps -a
curl -fsS http://127.0.0.1:8001/health; curl -fsS http://127.0.0.1:8001/ready
curl -sS -o /dev/null -w 'frontend_http=%{http_code}\n' http://127.0.0.1:4173/
# LAN からのアクセス許可(キー名の存在だけ。値は見ない)
grep -c '^TC_PUBLIC_HOSTS=' .env
```
`192.168.1.11` が許可に入っているかは、`.env` を開いて自分の目で確認する(値を貼らない)。無ければ追記して backend/frontend を再起動。

## 3. 画面の受入(同一 LAN: http://192.168.1.11:4173/)
管理者で `/admin/ops` を開く。
1. 「秘密情報・権限」: 保管先が「暫定: DB に暗号化して保管」と出る(「高セキュリティ移行完了」ではない)。
2. 旧データに `CHANGE_ME…` が残っていた鍵は「サンプル値(使えない)」と出る。→ 本物を登録し直す。
3. 鍵を登録 → 「登録済み・提供元の認証は未確認」になり、画面・応答に値が出ない(末尾4文字のみ)。
4. 「無効化」→「無効化済み(送らない)」。`.env` に値があっても使われない。
5. 「旧 .env から取り込む」: 旧 .env に本物の形の値がある鍵にだけボタンが出る(サンプル値の時は出ず、「サンプル値が残っています」と表示)。
   押すと理由の入力の後に新しい版として暗号化保存される。理由の欄に鍵を書くと拒否される。
6. 「API・契約と接続」: OpenAI・Places・Routes は「実装済み」。鍵の確認が無い間は「無効(送らない)」。
7. 「テスト実行」: Fake の提供元だけで、50円/旅行の上限が効き、超えると止まる。

## 3b. 実の鍵での確認(利用者が行う。費用がかかる)
OpenAI の残高・Google の課金とキーの制限(API 制限・送信元 IP)を提供元の画面で確かめてから行う。
1. 「秘密情報・権限」の上に「鍵の確認の今日の枠: 0円 / 50円」。各鍵に「有効性を確認」。
2. OpenAI の鍵で「有効性を確認」→ 理由を書いて「提供元へ確認を送る」。結果が「利用可能(この操作で確認)」なら「確認済み(期限内)」。
   「キー無効」「権限不足」「残高・利用枠が足りない」「このモデルは使えない」なら提供元の画面で直し、新しい鍵を登録(候補)→ 候補を確認 → 「候補を有効にする」。
3. Google のサーバー用の鍵で同じ操作。Places と Routes が別々に出る(どちらかが「API が有効になっていない」「送信元(IP・referrer)の制限で拒否」なら、その API を有効にする・許可 IP を今の回線の IP にする)。
4. 「API・契約と接続」で OpenAI・Places・Routes の送信が「送信できる」になる。

## 3c. 旅行の中の実送信(少数だけ)
1. 試験の会員に「テスト実行」で Journey を付ける(24時間)。その会員で旅行を開き、「AI と Google の機能」を使う。
2. 「AI に聞く」に家族旅行の条件(大人4人・枚方発・車・1泊2日・片道3時間以内・宿 6〜8万円)を書いて1回。案が「要確認」として出て、旅行には保存されない。
3. 「Google で場所を探す」を1回(例: 城崎温泉)。「提供: Google」と出る。「Google で経路を調べる」を1回(場所のある予定2つ)。
4. 利用枠の表示が増える(50円を越えない)。「原価の台帳」に openai・google_places・google_routes の行が出る。
5. 「秘密情報・権限」で OpenAI の鍵を「登録を無効にする」→ もう一度「AI に聞く」→「送りません」と出て、提供元の利用記録が増えない。
6. 数日後、OpenAI・Google の請求の明細と「原価の台帳」の見込みを照らし合わせる(請求が未確定の間は未確定と記録)。


## 4. 巻き戻し
問題があれば、反映前の SHA へ `git checkout <SHA>` して `docker compose up -d --build`。DB の形は変わっていないので、DB の戻しは不要。
