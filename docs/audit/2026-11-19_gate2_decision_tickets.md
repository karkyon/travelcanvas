# 製品固めゲート② 利用者の判断票と環境同期の記録(2026-11-19 夕。main `cd14e23` 時点)

> 区分: **【事実】**=コード・ログで確認した/**【提案】**=Claude の提案で未承認/**【未決】**=利用者の判断待ち。提案を決定済みとして実装・公開しない。

## 1. 環境同期の記録(利用者の実行ログによる)

| 環境 | 反映後の版 | バックアップ | DB head | 確認 | 根拠 |
|---|---|---|---|---|---|
| main | `cd14e23f228d493b36e1ff5185a6025ca45f140a` | — | — | CI #784 の必須5件(secret-scan・dependency-audit・backend・frontend・e2e)成功 | GitHub Actions |
| omega-dev2 | `cd14e23`(反映前 `2c8707b`) | `tc-20261119T053656Z`(検証OK) | `d5e9f3a7b2c6` | /health・/ready・画面・/admin/ops 200、LAN からの CORS OK | 利用者の実行ログ(2026-11-19 14:37 JST) |
| GCP VM `travelcanvas-dev` | `cd14e23`(反映前 `2c8707b`) | `tc-20261119T062516Z` | `d5e9f3a7b2c6` | /health・/ready・画面・/trip-consult・/admin/ops 200、CSP・CORS は同一 origin、/metrics は backend へ通さない、待ち受けは 127.0.0.1 のみ、tailnet 限定(Funnel なし)。反映後に `check` を再実行して OK | 利用者の実行ログ(2026-11-19 15:25 JST) |

- **【事実】** 両環境とも反映前は `2c8707b`、反映後は `cd14e23`。migration なし(head 不変)。
- **【事実】** GCP VM は omega-dev2 と DB を共有しない(VM 内の postgres。`docker-compose.gcp.yml`)。
- **未確認:** 両環境の稼働 SHA を、コンテナ内部の build SHA で突き合わせる確認は実施していない(checkout の SHA は両環境のログで `cd14e23`)。Cloud Run は別構成で、今回は触っていない。VM に「System restart required」の表示あり(OS の再起動待ち。TravelCanvas の反映とは別)。

## 2. 判断票

### T1 FC-086 通知の本文(通知秘匿)【未決】
- **要件(DOC-02 FC-086):** ロック画面に予約番号・健康・位置・旅程詳細を既定で表示しない。
- **【事実】** `backend/app/services/today_push.py` の `depart_messages`・`morning_message`・`rain_messages` が、通知の本文に**予定名と出発・開始の時刻**を既定で入れている(例:「{時刻} に出れば {時刻} の{予定名}にちょうど」)。予約番号は入れていない。
- **選択肢:**
  - A【提案・推奨】既定は予定名と時刻を入れない文言(「そろそろ出発」「今日の旅程があります」など)にし、詳細は画面を開いて見る。利用者が選んだ時だけ詳細を通知へ入れる。
  - B 現状維持(便利さを優先)。ただし要件との差異として台帳に残す。
  - C 時刻だけ入れ、予定名は入れない。
- **影響:** A/C は文言と試験の変更(`today_push.py`・`test_*push*`)。A で「詳細を入れる」設定を持たせる場合は、設定の保存先が要る(既存の通知設定の表で足りるかは未確認。足りなければ migration)。
- **保留の理由:** 通知仕様の変更は承認が要る。コードは変えていない。

### T2 DB の一意制約(候補からの採用)【未決】
- **【事実】** #134 で、候補の行を `FOR UPDATE` で押さえて並列の採用を直列にした(別接続4並列の試験で、修正前は Place が4件・修正後は1件)。DB の一意制約は無い。PostgreSQL 既定の READ COMMITTED を前提にしている。
- **選択肢:** 一意制約を入れない(現状)/部分一意インデックス `places(created_by, adopted_from_candidate_id) WHERE adopted_from_candidate_id IS NOT NULL` を足す【提案】。
- **入れる前に必要なこと:** 既存データに重複が無いか。無い場合だけ migration で足せる。あれば、重複した Place を1件に統合する(Place を参照する表が複数ある — 予定・出典・項目ごとの出典・移動区間など — ので、参照の付け替えが要る)。
- **重複の確認(読み取りだけ・変更なし。両環境で実行できる):**
  ```sql
  SELECT created_by, adopted_from_candidate_id, count(*) FROM places
  WHERE adopted_from_candidate_id IS NOT NULL
  GROUP BY 1, 2 HAVING count(*) > 1;
  ```
- **戻し方:** インデックスを drop するだけ。
- **提案:** 上の確認が 0 行なら、小さな migration を別 PR で足す(承認後)。急ぎではない(ロックで並列は守れている)。

### T3 LICENSE【未決】
- **【事実】** リポジトリに `LICENSE` ファイルが無いのに、README は「MIT License - see LICENSE file for details.」と書いている(不整合)。
- **選択肢:** (a) MIT の `LICENSE` を置く(権利者名と年を利用者が決める) (b) README の表記を「未定」に直す (c) 別のライセンスを選ぶ。
- **保留の理由:** 権利者・採用ライセンスは利用者の決定。誤った LICENSE は置かない。

### T4 未使用ファイル `frontend/src/frontend_spot_integration.py`【未決】
- **【事実】** 1071行。コード・CI・scripts・文書のどこからも参照されない(台帳 G2-X-2 の調査。今回も main で再確認: 台帳以外の参照なし)。
- **提案:** 削除する小さな PR を作る。git の履歴に残るので戻せる。承認があれば実施。

### T5〜T7(別紙を参照。決定済みではない)
| # | 論点 | 参照 | 状態 |
|---|---|---|---|
| T5 | 会員の名称・4段階・価格(Free ¥0 / Trip ¥390 / Journey ¥680・1,800・6,800 / Explorer ¥1,480・3,900・14,800)・期間 | `2026-11-19_gate2_membership_and_code_closure.md` | **未承認の仮説**。内部の quota クラス(コードにある)と販売案を分けて記載済み。商標確認は未 |
| T6 | Stripe 手数料・消費税・特商法・返金/復帰条件 | 同上 | 国内カード 3.6% 以外は公式の再確認前。確定コストとして扱わない |
| T7 | 利用計測(個人の旅行情報を送らない・既定 OFF・同意/撤回/削除/保存期間/最小人数/閲覧権限) | 同上 | 推奨のみ。決定済みではない |

## 3. 未了(この文書では解消していない)
- FC-001〜100 の**意味での**照合(番号言及の集計は実装の証拠ではない)。
- 旅行体験の縦断導線レビュー(相談→記録)の全面実施。UI の自動試験で判定できる範囲を超える実機・実API・実旅行の確認。
- DOC-04/05/06/07/11 の全文の突き合わせ。
