# Gate SecretPolicy 受入手順(omega-dev2 / 192.168.1.11)

対象: PR「Gate SecretPolicy」を main へ入れた後の LAN 受入。**migration は無い**(DB の形は変わらない)。
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
docker compose build backend frontend && docker compose up -d
docker compose exec -T backend alembic current   # 反映前と同じ(この Gate に migration は無い)
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
5. 「旧 .env から取り込む」: 本物があれば取り込める。サンプル値は拒否される。
6. 「API・契約」: 鍵を登録しても外部送信は無効のまま(adapter 未実装)。
7. 「テスト実行」: Fake の提供元だけで、50円/旅行の上限が効き、超えると止まる。
**実 API の呼び出しは、この受入に含めない**(原価の実測・請求の照合・利用者の明示の許可が揃うまで行わない)。

## 4. 巻き戻し
問題があれば、反映前の SHA へ `git checkout <SHA>` して `docker compose up -d --build`。DB の形は変わっていないので、DB の戻しは不要。
