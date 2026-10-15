# Gate P10 FR-030/FR-031 トレーサビリティ表

- 対象: FR-031 安全な再計画、FR-030 外部状況(alert/impact domain)(DOC-02)、SC-24
- Gate: P10(DB・API・UI・E2Eの縦切り)
- 前提: Gate P9適用後
- 関連ADR: `docs/adr/ADR-replan.md`
- migration: `f7a3d1c8e2b5`(revises `e6c1a9d3b7f2`、2テーブル新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p10_replans.py`(B)、`frontend/src/...`(F)、`frontend/e2e/replan.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 問題イベントを起点に代替案A/Bを提示 | FR-031 | IMPLEMENTED | B `test_delay_candidates_protect_fixed_events`, `test_closure_and_weather_candidates`; F `AlertsPage.test.tsx`; E |
| 2 | 固定予約(確定・予約付き)を守る | FR-031 | IMPLEMENTED | B `test_delay_candidates_protect_fixed_events`, `test_delay_fixed_target_overflow_and_related`; E |
| 3 | 変更対象・失う予定・遅延差・費用差・通知対象を表示 | FR-031、SC-24 | IMPLEMENTED | B `test_replan_apply_notify_and_undo`; F `replanModel.test.ts`, `AlertsPage.test.tsx`; E |
| 4 | 利用者承認前に共有旅程を変更しない | FR-031 | IMPLEMENTED | B `test_replan_apply_notify_and_undo`, `test_stale_and_conflict_do_not_touch_plan`; E |
| 5 | 承認後に変更セットを適用、Undo可能 | SC-24、共通不変条件4 | IMPLEMENTED | B `test_replan_apply_notify_and_undo`, `test_closure_move_next_day_and_reject`; E |
| 6 | 共同者へ差分通知(本文に予定名なし) | SC-24 | IMPLEMENTED | B `test_replan_apply_notify_and_undo` |
| 7 | 古い案・紐付けが増えた予定は適用しない | 共通不変条件4、DOC-06 楽観ロック | IMPLEMENTED | B `test_stale_and_conflict_do_not_touch_plan`; F |
| 8 | 外部値の確実性・取得時刻を表示、古い値を現在値に見せない | FR-030 | IMPLEMENTED | B `test_create_and_list_alerts_validation`, `test_validate_alert_and_staleness`; F |
| 9 | 影響イベント・外部ソース・確度・利用者確認の表示 | SC-24 | IMPLEMENTED | B `test_create_and_list_alerts_validation`; F; E |
| 10 | 登録済み経路の遅延・運休の検出 | FR-030 | IMPLEMENTED | B `test_deleted_target_and_detected_route_status`; F |
| 11 | 権限・楽観ロック・監査に内容なし | DOC-06、DOC-11 | IMPLEMENTED | B `test_permissions`, `test_create_and_list_alerts_validation` |
| 12 | 契約・URL実在 | Gate C2b方式 | IMPLEMENTED | fixture 11種; F `contract.test.ts`, `c2b3.test.ts`, `p10replans.test.ts` |
| 13 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 状況の一覧2回・案の比較) |
| 14 | 外部provider(運行情報・天気・警報・休業)からの取得 | FR-030 | NOT STARTED | ADR §3 |
| 15 | 代替移動手段の探索・移動時間を考慮した案 | FR-031 | NOT STARTED | ADR §3 |
| 16 | リアルタイム・プッシュ通知 | DOC-06 §15 | NOT STARTED | ADR §3 |
