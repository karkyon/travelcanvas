# Gate L2 FR-016 トレーサビリティ表

- 対象: FR-016 制約管理(DOC-02)、FR-023の秘匿表示の一部
- Gate: L2(DB・API・UI・E2Eの縦切り)
- 前提HEAD: `5b73cfeb16e8a09876a50115d6c838ca37deb82f`
- 関連ADR: `docs/adr/ADR-constraints.md`
- migration: `b7d41e9c2a53`(revises `7f2a4c9e1b36`、`constraints`テーブル新設のみ)

凡例: `IMPLEMENTED`(実装・検証済み) / `PARTIAL`(一部) / `NOT STARTED`(未着手)。
試験名は `backend/tests/test_gate_l2_constraints.py`(B)、`frontend/src/...`(F)、`frontend/e2e/constraints.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | ハード制約: 予約・営業時間・終電・集合・予算上限・不可条件 | FR-016 | IMPLEMENTED | `CONSTRAINT_TYPES`; B `test_create_shared_hard_constraint`; E(予算上限) |
| 2 | ソフト制約: 希望・疲労・景観・食事間隔・移動回避・優先度、重み | FR-016 | IMPLEMENTED | B `test_weight_rules_follow_hardness`; E(移動回避・重み80) |
| 3 | hardはweight不要 | DOC-05 §17 | IMPLEMENTED | DB CHECK `ck_constraints_weight`; B `test_weight_rules_follow_hardness`, `test_database_check_constraints_guard_invariants` |
| 4 | 機械判定可能な値(時刻/数値+単位/文字) | DOC-13「制約」 | IMPLEMENTED | `_validate_value`; B `test_value_validation_by_operator`(16通り); F `constraintModel.test.ts` |
| 5 | 個人・グループ・イベント・日単位で適用 | FR-016 | IMPLEMENTED | scope_type plan/day/event/member; B `test_scope_resolution_and_labels`, `test_deleted_scope_target_is_reported_as_missing` |
| 6 | 秘匿制約は詳細非表示のまま判定へ使う | FR-016 | IMPLEMENTED(判定はL3) | masked応答; `load_constraints_for_evaluation`; B `test_private_detail_is_hidden_from_other_members_including_plan_owner`, `test_evaluation_loader_uses_private_values_and_filters` |
| 7 | privateはowner必須、平文を持たない | DOC-05 §17 | IMPLEMENTED | owner_user_id NOT NULL; CHECK `ck_constraints_privacy_payload`; B `test_private_constraint_is_stored_only_as_ciphertext` |
| 8 | reasonは本人のみ(R) | DOC-05 §19 | IMPLEMENTED | B `test_shared_constraint_reason_is_visible_only_to_its_author`; E(理由の本人表示) |
| 9 | 権限(private=本人) | DOC-06 §21 | IMPLEMENTED | B `test_permission_matrix` |
| 10 | 楽観ロック(If-Match) | DOC-06 §23 | IMPLEMENTED | B `test_update_requires_if_match_and_bumps_revision`; F `l2constraints.test.ts` |
| 11 | 監査(秘密本文を記録しない) | DOC-05 §10.1 | IMPLEMENTED | B `test_audit_details_never_contain_constraint_text` |
| 12 | 検証不能を問題なしにしない | FR-017 | IMPLEMENTED(読み出し側) | B `test_undecryptable_private_constraint_is_reported_not_dropped` |
| 13 | 画面: 制約ゼロと未検証を同じ表示にしない | SC-15 | IMPLEMENTED | F `ConstraintsPage.test.tsx`; E(空表示と注記) |
| 14 | 画面から到達・登録・再読込後の保持・無効化・削除 | DOC-02 §1.1 | IMPLEMENTED | E `constraints.spec.ts`(ゲスト) |
| 15 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 空画面・追加ダイアログ・登録後) |
| 16 | 実backend応答との契約 | Gate C2b方式 | IMPLEMENTED | fixture `constraint_*`(9種); F `contract.test.ts`, `c2b3.test.ts`(URL実在) |
| 17 | 旅程が制約を満たすかの検証 | FR-017 | NOT STARTED | Gate L3 |
| 18 | 最適化への制約反映 | FR-018 | NOT STARTED | Gate L4 |
| 19 | 秘匿プロフィール(予算・健康等)と「満たす/満たさない」表示 | FR-023 | PARTIAL | 秘匿の保存・非表示のみ。充足表示はL3以降 |

## 同Gateで修正した既存不具合

| 不具合 | 影響 | 修正・証拠 |
|---|---|---|
| CORSの`allow_methods`にPATCHが無い | 区間・経路候補・経路区間・予約×イベント紐付けの編集がブラウザから一度も送信されていなかった | `CORS_ALLOWED_METHODS`にPATCH追加; B `test_gate_l2_cors_methods.py`(全ルートのメソッドが許可されていること) |
