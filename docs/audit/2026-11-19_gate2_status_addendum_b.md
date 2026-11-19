# 製品固めゲート② 追補 B(2026-11-19 夕。main `dac0b51` 時点)

> 台帳 `2026-11-18_gate2_ledger.md` は PR #138 が末尾へ追記中のため、衝突を避けて別紙にした。#138 の取り込み後に台帳から本書へリンクする。
> 並行して別の作業(台帳 §7.3 の A-1〜A-6)が同じ範囲を進めている。本書は**それと重ならない新しい事実だけ**を書く。

## 1. 作業基準(GitHub から取り直した値)

| 項目 | 値 | 根拠 |
|---|---|---|
| main | `dac0b513980a2ee17d4a49ce3b7b9e3974ca0fa1`(Dev/gate2 finalization #137) | `git ls-remote`・`git rev-parse origin/main` |
| main の CI | run #770(id 44447371725): secret-scan・dependency-audit・frontend・backend・e2e の**5件とも success** | GitHub Actions の check-runs(head_sha が上の SHA と一致) |
| `2c8707b`(omega-dev2 の反映済み版)→ `dac0b51` の差分 | **docs の 2 ファイルだけ**(`2026-11-18_gate2_ledger.md` +8、`2026-11-19_gate2_membership_and_code_closure.md` +12)。コード・migration・設定の差分なし。Alembic head は `d5e9f3a7b2c6` のまま | `git diff --stat 2c8707b dac0b51` |

**意味:** omega-dev2 で動いているコードは、最新 main と同じ。`dac0b51` への反映は checkout の SHA をそろえるだけで、DB・画面・API の変化は起きない(再 build してもよいが必須ではない)。

## 2. open PR の最新化(main の取り込み)

古い base の 6 本を、GitHub の「Update branch」(main を merge する。履歴の書き換えなし)で最新 main に載せた。

| PR | 旧 base | 新 head | 単独で main に重ねた時 | 備考 |
|---|---|---|---|---|
| #129 | `32c7db6` | `bbe5894` | 衝突なし | — |
| #130 | `32c7db6` | `0d08592` | 衝突なし | — |
| #131 | `32c7db6` | `ded6046` | 衝突なし | #129 の後に入れると `SpotModePage.test.tsx` で衝突(両方の試験を残せば解消。台帳 §7.3 A-3 と同じ所見) |
| #133 | `2c8707b` | `2e9469e` | 衝突なし | — |
| #134 | `2c8707b` | `71aed28` | 衝突なし | — |
| #135 | `2c8707b` | `ee4656f` | 衝突なし | — |
| #138 | `dac0b51` | (別作業で更新中) | 衝突なし | — |

CI の結果は各 PR の画面で確認する(本書の作成時点では backend・e2e が実行中)。**どの PR もマージしていない。**

## 3. PR #134 のレビュー所見(同時リクエスト)

- `SELECT … FOR UPDATE` で候補の行を押さえ、ロックの解放後に「作成済みの Place」を探し直す。**PostgreSQL の既定の分離レベル READ COMMITTED(`app/core/database.py` は isolation_level を指定していない)では**、後の要求の次の文が先の確定を見るため、Place は 1 件に収束する。
- 試験は別々の接続・4 スレッドで実際に並列実行している(共通の試験セッションでは再現できない点も明記)。
- **残る注意(阻害ではない):** (a) 分離レベルを REPEATABLE READ 以上に変えると、後の要求が古い snapshot で探して重複を作りうる(暗黙の前提)。(b) DB の一意制約は無い(migration が要るため保留。台帳 A-1 と同じ)。ロックを通らない別の経路を将来足すと重複しうる。
- Place には論理削除が無く、`adopt` の結果は 1 つの transaction で確定するため、途中失敗で孤児の Place は残らない。

## 4. PR #138 の確認

- `scripts/audit/gen_fc_lineage.py` を PR の head で再実行し、生成物が commit されたものと**完全に一致**した(80 行・連番・重複なし)。DOC-02 v6.0 §9.10 に規則表現があることも本文で確認した。
- 注意: v5.1 の 16 FR の値はスクリプトに書き写したもので、v5.1 の保管版はリポジトリに無い。**書き写しの正しさは、リポジトリの中だけでは検証できない**(保管版との目視の照合が要る)。

## 5. FC-001〜100 の未参照 68 件(G2-09-D の続き)

`docs/audit/2026-11-19_fc001-100_unreferenced_scan.md`(`scripts/audit/scan_fc_unreferenced.py` で再生成)。語の検索による**根拠の候補**の分類で、検証済みの意味ではない。

| 分類 | 件数 |
|---|---|
| 語の一致あり(要確認) | 60 |
| 試験根拠薄(FC-040・FC-057・FC-076) | 3 |
| 試験根拠なし(FC-014 自動保存) | 1 |
| 根拠未特定(FC-010 複数日イベント) | 1 |
| 未実装(将来要件)(FC-044 Wallet) | 1 |
| 根拠あり(候補)(FC-096 支援アクセス) | 1 |
| **要件との差異の候補(FC-086 通知秘匿)** | 1 |

**FC-086(コードで確認):** Web Push の本文に予定名と出発・開始の時刻を既定で入れている(`backend/app/services/today_push.py` の `depart_messages`・`morning_message`・`rain_messages`)。要件は「ロック画面に…旅程詳細を既定表示しない」。予約番号は入れていない。**仕様の判断が要るため、コードは変えていない。**

## 6. 環境(omega-dev2・GCP)

| 環境 | 状態 | 止まった所 |
|---|---|---|
| omega-dev2 | **この作業では未接続・未反映**。利用者の実行ログ上は `2c8707b` に反映済み(コードは最新 main と同じ。§1) | この作業環境に SSH の鍵・LAN(192.168.1.11)への経路・接続できる利用者の端末が無い |
| GCP VM | **未接続・未確認**。VM が作られているかもこちらでは確かめられない(runbook の状態欄は 2026-11-09 の「VM の作成・配備は未実施」のまま) | `gcloud auth list` で認証済みのアカウントなし。Tailscale・IAP の経路なし |
| GCP の DB | `docker-compose.gcp.yml` は VM の中の postgres を使い、`.env` も VM で別に作る(`gcp_vm.sh env`)。**omega-dev2 と DB は共有しない**(設定の読み取り) | — |

反映の手順は利用者が実行する(手順は最終報告に記載)。**「同期済み」とは書かない。**
