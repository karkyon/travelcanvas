# Gate SecretPolicy 受入手順(omega-dev2 / 192.168.1.11)

対象: PR「Gate SecretPolicy」「Gate ProviderConnect」「Gate ConsultAI」を main へ入れた後の LAN 受入。
**migration が 2つある**(`b7e3c9d1f5a2`: 鍵の確認の列・確認の記録の表。既存の鍵は消さず unverified のまま。
`c3e5a7b9d1f4`: 旅行相談の相談の表 trip_consult_sessions・口座の範囲 consult)。
**`.env` に `PROVIDER_HTTP_STUB` を入れない**(CI の E2E だけの模擬の提供元。入っていると実の API へ送らない。画面に「模擬」と出る)。
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
docker compose exec -T backend alembic current   # c3e5a7b9d1f4 (head)
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


## 3d. 旅行相談の AI(http://192.168.1.11:4173/trip-consult)
前提: 3b で OpenAI とGoogle のサーバー用の鍵が「確認済み(期限内・72時間)」。試験の会員に Journey 以上(3c の 1)。
1. 「AI で読み取る」の枠に、会員のクラス・AI の状態・同意の印が出る。同意の印が無ければ印を付ける(設定のプライバシーでも同じ)。
   状態が「使えます(gpt-5-nano)」でない時は、出ている理由(クラス・鍵の確認・停止)を直す。「模擬」の帯が出たら `.env` に
   `PROVIDER_HTTP_STUB` が入っているので外して backend を再起動する。
2. 希望・事情に「家族4人で1泊2日。枚方から車で片道3時間くらいまで。宿泊費は4人で6〜8万円。2026年11月28日に出発。
   人が多すぎない所。伊勢、福井、滋賀などが候補。」、出発地に「大阪府枚方市」→「AI で読み取る」を1回。
3. 確認の画面: 「AI(OpenAI)の読み取りです」。AI の行は「AI の読み取り · 未確認 · 合っていれば印」で、印を付けた行だけ条件に使う。
   片道の時間・宿泊費の範囲を選ぶ。「AI の方面の案(未確認)」から1つ「比較に足す」。
4. 「この条件で方面を比較する」→ 方面を1つ開く →「Google で調べる」で「探す」を1回・「経路を調べる」を1回。
   「提供: Google · 取得 …」と出る。場所を1つ「参考の出典に足す」。
5. 「○○で旅程案を作る」→ 下書き(未確定)。旅程の利用枠(50円)に相談で使った分が入っている(50円を越えない)。
6. 「原価の台帳」に openai・google_places・google_routes の行。相談の文章・AI の結果は保存されていない(監査は件数だけ)。
7. 送る前に断る確認: 同意の印を外す →「AI で読み取る」が押せない。Free の会員では「Free のクラスには含まれません」。

## 4. 反映の道具と巻き戻し
反映は `TC_EXPECT_HEAD=<SHA> bash scripts/ops/consultai_apply.sh push`(push → 統合 PR → CI)と、merge の後の
`TC_EXPECT_HEAD=<SHA> bash scripts/ops/consultai_apply.sh deploy` で行う。deploy は何かを変える前に、main に変更が入っているか
(merge・squash)・main の CI・未追跡のファイルの衝突・`.env` の模擬の設定を確かめ、元の branch・SHA・DB の revision・
退避(stash)・バックアップの ID を `~/tc-artifacts/deploy-<日時>.state` に残す。

巻き戻しは決め打ちの downgrade をしない(元のコードが知らない revision に DB を下げない・相談の口座を消さない)。
1. 原因を直して前へ進める(推奨)。
2. DB の revision が変わっていなければ、state の `prev_sha` へ `git checkout` して `docker compose up -d --build`。
3. DB も戻す必要がある時は、元のコードで `python3 scripts/ops/tcops.py restore <backup>`(バックアップの後のデータは消える)。
4. 退避した変更は `git stash list` で確かめて `git stash pop`。
