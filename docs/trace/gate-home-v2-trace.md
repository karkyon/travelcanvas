# Gate HomeV2 — ホーム(ダッシュボード)v2 の実装

正本: 利用者の決定(2026-11-04 15:48)「Travelcanvas ホーム改善案 v2 モックアップこの案で実装進めろ」。
名前の変更: 旅の棚 → **旅行の一覧**、思い出 → **旅の記録と思い出**。設計: `docs/ux/TravelCanvas_ホーム改善案_v2_モックアップ.html`。

## 対応

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | 旅行の状態: 計画中(旅行前・旅行中)/ 検討中(日付なし)/ 行った旅(旅行後)/ 見送り・中止(利用者が決める) | IMPLEMENTED | `dashboard_home.shelf_of`、旅行の `status = cancelled`(既存の列。移行なし)、`PUT /dashboard/trips/{plan_id}/state`(編集できる人だけ・監査) | `test_gate_home_v2.py` |
| 2 | いま計画中: 主役の旅行(表紙・操作)+ 旅の準備の段階(行き先と日付・立ち寄る場所・移動手段・予約と確認・持ち物)。主役は計画中の旅行から選べる | IMPLEMENTED | `dashboard_home.planning_detail`、`HomeProgress`・`NextTasks` | 同上・`DashboardPage.test.tsx`(HomeV2) |
| 3 | 次にやること: 計画中の旅行ぜんぶから重要な順(準備の確認・移動手段・立ち寄る場所・持ち物)に 4 件 | IMPLEMENTED | `dashboard_home.merge_tasks`(リンクは画面の中の道だけ) | 同上 |
| 4 | 旅行の一覧: 状態のタブ・件数・予定と写真の数・「見送りにする / もう一度計画する」 | IMPLEMENTED | `TripShelves` | 同上・E2E `gate-g9` |
| 5 | 旅の記録と思い出: 最近行った旅の写真(見られる写真だけ)・写真とメモの数・旅の記録 / 振り返りへ・行った旅の時系列 | IMPLEMENTED | `MemoriesSection` | 同上 |
| 6 | 旅の足あと: 行った都道府県(行き先・予定の住所に書かれた名前だけ。推測しない)・今年の旅の日数・写真の数・都道府県のタイル地図(計画中は別の色) | IMPLEMENTED | `dashboard_home.prefectures_in`・`Footprints` | 同上 |
| 7 | 行ってみたい場所: お気に入りのスポットを種類別に。空の時は探し方の案内 | IMPLEMENTED | `Wishlist` | 同上 |
| 8 | 道具: スポット検索・共有・オフライン・しおり・旅の地図・設定 | IMPLEMENTED | `Tools` | 同上 |

**次の段階(未実装)**: 左の帯とスマホの下のタブを「ホーム / 旅行 / 旅の記録と思い出 / 行ってみたい場所」に揃える。行ってみたい場所から旅行をつくる。
