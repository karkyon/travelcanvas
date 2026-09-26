# ADR: プラン削除の2段階化(論理削除 → 猶予期間 → 完全削除)

- 状態: 採用(Gate B-012)
- 前提HEAD: `d8a217ce5781a5dccadb8762e6f56a103505923d`
- 関連: DOC-02 §5(データ保持)・EX-015・FC-099・FR-004・FR-039、DOC-05 §22・§23、DOC-11
- トレーサビリティ: `docs/trace/gate-b012-trace.md`

## 1. 背景(B-012)

`DELETE /travel-plans/{id}` は `db.delete(plan)` でプランを物理削除していたが、プランを参照する
子テーブル20以上の外部キーがすべて NO ACTION(制約・検証結果の2つを除く)で、削除時の扱いが
定義されていなかった。日程・予定を1件追加するだけで変更履歴(`change_sets`)が作られるため、
**ほぼ全ての実プランが削除できず500になっていた**。子データの種類ごとの再現結果:

| プランが持つもの | 失敗した外部キー |
|---|---|
| 日程1件 | `change_sets.plan_id` |
| 予約 | `reservations.plan_id` / `reservations.event_id` |
| 移動区間・経路候補 | `travel_segments` / `route_options` の予定参照 |
| 文書・取込 | `documents.plan_id` / `import_jobs.plan_id` |
| 開かれた共有リンク | `share_access_logs.share_id` |
| 招待(通知) | `notifications.related_plan_id` |
| QuickDraftから作成 | `quick_drafts.promoted_plan_id` |

## 2. 決定

### 2.1 2段階削除

DOC-02 §5「登録旅行: 猶予後削除 / ゲスト: 即時共有失効 / 予約・文書: 削除 / 監査: 独立保持」、
EX-015「削除済みプランへ更新を適用しない」、FC-099「Object・共有を追跡削除」に従う。

| 段階 | 処理 |
|---|---|
| 論理削除(`DELETE /travel-plans/{id}`、所有者のみ) | `deleted_at`・`deleted_by_user_id`・`purge_after`(既定30日後、`PLAN_DELETE_GRACE_DAYS`)を記録し、共有リンクを即時失効。以後 `require_plan_access` を含む全経路で404 |
| 復元(`POST /travel-plans/{id}/restore`、所有者のみ・猶予期間内) | 論理削除を取り消す。共有リンクは失効したまま(再発行が必要)。期限切れは410 |
| 完全削除(`DELETE /travel-plans/{id}/permanent`、または `scripts/run_plan_purge.py`) | 文書の実ファイルを先に削除し(1件でも失敗したら保留・再試行)、`DELETE FROM travel_plans` 1文で子データごと物理削除 |

論理削除中のプランを除外した経路: `require_plan_access`(正規化API・予約・文書・当日等すべて)、
プラン一覧、公開共有の解決、招待一覧・承諾・辞退、管理統計。

### 2.2 外部キーの削除方針(migration `e5b9c2d8f341`)

| 方針 | 対象 | 理由 |
|---|---|---|
| ON DELETE CASCADE(20件) | 日程・予定・変更履歴(明細)・版・共有リンク・共同編集者・予約とその紐付け/参加者/チケット・区間・経路候補/経路区間・文書/文書リンク・取込/抽出候補・`event_links` | プランが所有するデータ |
| ON DELETE SET NULL(3件) | 通知・QuickDraft・共有アクセスログ | プラン外のデータ。アクセスログはDOC-05で180日保持のため残す |
| DEFERRABLE INITIALLY IMMEDIATE(12件) | 予約→予定、紐付け→予定、区間→予定/予約/経路候補、経路候補→予定、参加者/チケット→共同編集者、取込→文書/予約 | プラン内の横の参照(下記) |

PostgreSQLは連鎖削除をテーブルごとの内部文で順に実行し、NO ACTIONの検査も内部文ごとに行う。
このため横の参照(例: 参加者→共同編集者)は、参照元がまだ連鎖削除されていない時点で検査されて
失敗する(トランザクション内の実験で確認)。SET NULLは区間端点のXOR CHECKを壊し
(ADR-travel-segment)、予定の個別削除などの既存の挙動も変えるため使わない。
DEFERRABLE INITIALLY IMMEDIATE は通常の操作では従来どおり即時に検査し、完全削除だけが
`SET CONSTRAINTS ALL DEFERRED` で検査をコミット時まで遅らせる。

ORMの `TravelPlan.days / share_links / collaborators` には `passive_deletes=True` を付け、
プランの物理削除をDBの連鎖削除に任せる。

`tests/test_gate_b012_plan_deletion.py` の `test_every_foreign_key_into_plan_owned_tables_has_a_deletion_policy`
が、実DBの外部キー一覧から「プランから連鎖削除される表を参照する外部キーは CASCADE / SET NULL /
DEFERRABLE のいずれか」を検査する。将来テーブルを追加した時にB-012が再発しないようにするため。

### 2.3 監査・暗号化データ

- 監査ログ(`audit_logs`)はプランへの外部キーを持たず残る。`plan.delete` / `plan.restore` / `plan.purge`
  を記録し、プランIDと件数だけを残す(題名等の内容は記録しない)。
- 予約の確認番号・PIN、チケット、秘匿制約などの暗号化列は完全削除で行ごと消える。論理削除中は
  どのAPIからも取得できない。KMS未導入のため「暗号鍵破棄を含む削除」(DOC-02 §5)は未達のまま。
- バックアップに残る期間の説明(FR-039)は運用文書の範囲とし、本Gateでは扱わない。

### 2.4 画面

- プラン一覧の削除確認とプラン詳細の削除確認で「30日以内なら復元できる」旨を表示する
  (以前は「取り消すことができません」と表示していた)。
- 一覧の下に「最近削除したプラン」(件数・完全削除の予定日と残り日数・復元・完全に削除)。
  削除済みが無ければ表示しない。
- 以前は削除失敗時もプラン詳細が「削除しました」と表示し、成功時は通知が二重に出ていた。
  通知はplanStoreに一本化し、失敗は呼出元へ伝える。

## 3. downgrade

外部キーを元の NO ACTION・即時検査へ戻し、追加列を削除する。downgrade時点で論理削除中の
プランは再び表示される(データは削除しない)。

## 4. スコープ外・別Gate

- **B-013(同じ原因の個別削除の500、別Gate)**: 予約に紐付いた予定の削除、その予定を含む日程の削除、
  参加者・チケット担当者になっている共同編集者の削除。「紐付けを外して削除」か「409で拒否」かの
  製品判断が必要なため本Gateでは扱わない。一度開かれた共有リンクの削除は、本Gateの
  `share_access_logs.share_id` SET NULL で解消した。
- 完全削除バッチのスケジューラ設定(既存purgeスクリプトと同じ運用)。
- アカウント単位の削除・エクスポート(FR-039)。
