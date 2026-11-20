# 製品固めゲート② 追補 D(2026-11-20。環境への反映と反映後の確認)

> **この作業では、環境への反映も実環境での確認も「未実施」。** Claude の作業環境から omega-dev2・GCP VM へ入る手段が無く
> (SSH の鍵・LAN/tailnet の経路・gcloud の認証が無い。利用者の端末も接続されていない)、どちらにも触れていない。
> 以下は、利用者が実行して結果を貼るための手順と記入欄。**結果が貼られるまで、どの欄も成功と書かない。**

## 1. 反映する版(GitHub で確認した事実)

| 項目 | 値 | 確認 |
|---|---|---|
| main | `1aeab35d5f33f6c16851ef0d46fbe78f4f6921fa`(#150) | `git rev-parse origin/main`(2026-11-20) |
| main の CI | run #802: secret-scan・dependency-audit・frontend・backend・e2e の **5 件とも success**(同じ SHA) | GitHub の check-runs |
| 前回の反映 | 両環境とも `cd14e23`(利用者の実行ログ。2026-11-19) | — |
| `cd14e23` → `1aeab35` | コードの変更を含む(招待・ログインのメールの照合、予約の重複の候補、`tc_transfer`、E2E)。**migration は無い**(Alembic head は `d5e9f3a7b2c6` のまま) | `git diff` |

## 2. 手順(利用者の端末で。承認済みの範囲)

各環境で、**反映の前と後に** `scripts/ops/gate2_env_record.sh` を 1 回ずつ流し、出力を貼る(読み取りだけ。秘密の値・個人の情報は出さない)。

### omega-dev2
```bash
cd ~/projects/travelcanvas && git fetch origin main && bash <(git show origin/main:scripts/ops/gate2_env_record.sh)
```
```bash
cd ~/projects/travelcanvas && TC_BRANCH=main bash <(git show origin/main:scripts/ops/local_dev_apply.sh)
```
(`local_dev_apply.sh` の既定の branch は `dev/plan-b`。**必ず `TC_BRANCH=main` を付ける**。バックアップ・migration・health/ready・画面・CORS の確認は道具が行う)
```bash
cd ~/projects/travelcanvas && bash scripts/ops/gate2_env_record.sh
```

### GCP VM(omega-dev2 で OK の後)
```bash
cd ~/projects/travelcanvas && git fetch origin main && bash <(git show origin/main:scripts/ops/gate2_env_record.sh)
```
```bash
cd ~/projects/travelcanvas && bash scripts/ops/gcp_vm.sh deploy 1aeab35d5f33f6c16851ef0d46fbe78f4f6921fa
```
(main に入った commit だけを受け付け、バックアップを先に取る)
```bash
cd ~/projects/travelcanvas && bash scripts/ops/gate2_env_record.sh
```

## 3. 記入欄(結果が貼られたら埋める)

| 項目 | 期待 | omega-dev2 前 | omega-dev2 後 | GCP VM 前 | GCP VM 後 |
|---|---|---|---|---|---|
| head(稼働の SHA) | `1aeab35…`(後) | 未実施 | 未実施 | 未実施 | 未実施 |
| backend・frontend の状態 | running / healthy | 未実施 | 未実施 | 未実施 | 未実施 |
| Alembic current = heads | `d5e9f3a7b2c6` | 未実施 | 未実施 | 未実施 | 未実施 |
| /health・/ready | 200・200 | 未実施 | 未実施 | 未実施 | 未実施 |
| /ready の checks | すべて true(`migration_current` を含む) | 未実施 | 未実施 | 未実施 | 未実施 |
| 管理コンソール画面 `/admin/ops` | 200 (画面routeの応答のみ。ログイン/管理APIの認証・データ取得を検証するものではない) | 未実施 | 未実施 | 未実施 | 未実施 |
| バックアップの ID | 道具の出力 | — | 未実施 | — | 未実施 |
| T2 重複の組(`t2_duplicate_groups`) | 0 なら一意制約を足せる(足すかは判断待ち) | 未実施 | — | 未実施 | — |
| 大文字小文字違いのアカウントの組(`users_case_duplicate_groups`) | 0 が望ましい(1 以上ならその人は完全一致でしかログインできない) | 未実施 | — | 未実施 | — |
| 正規化前の招待(`invites_non_normalized`) | 件数の記録だけ(照合は双方を小文字にするので承諾できる) | 未実施 | — | 未実施 | — |

**注意:** コンテナの image に build の SHA は入っていない。「稼働の SHA」は Git の HEAD と、反映の道具が作り直した時刻で見る(image の中身と SHA の機械的な突き合わせは未対応)。

## 4. 反映後の確認(実環境で。手で行う。未実施)

テスト用の会員を使う。実在の人のメールアドレスは使わない(例: `gate2-check+日時@example.com` のような自分のメールの別名)。

| # | 確認 | 手順 | 期待 | 結果 |
|---|---|---|---|---|
| C-1 | 招待(#147・FC-061) | 会員 A が旅行の共有から、会員 B のメールを **大文字を混ぜて**(例: `Gate2-Check@Example.com`)招待する → B でログインし、通知/招待の一覧を開く | B の一覧に出て、承諾でき、旅行が見える | 未実施 |
| C-2 | 招待の取り違え | 別の会員 C でログインして同じ招待を探す | C には出ない(承諾もできない) | 未実施 |
| C-3 | ログイン(#150) | `Gate2-Check@example.com` で登録した会員で、`gate2-check@example.com`(全部小文字)と打ってログインする | ログインできる | 未実施 |
| C-4 | 二重登録(#150) | `GATE2-CHECK@example.com` で新しく登録する | 「既に使用されています」で断られる | 未実施 |
| C-5 | 予約の重複の候補(#147・FC-042) | 1 つの旅行に、同じ予約番号の予約を 2 件(取り込みと手入力など)入れて、予約の一覧を開く | 両方の行に「同じ予約かもしれません」が出る。**どちらも消えていない** | 未実施 |
| C-6 | 後片付け | 確認に使った予約・旅行・会員を画面から消す | 消える | 未実施 |

## 5. 未確認のまま残るもの

- 上の 3・4 のすべて(結果が貼られるまで)。
- 実機(iPhone・Android・iPad)・実 API・実旅行の証拠は増えていない。Gate② は完了ではない。
