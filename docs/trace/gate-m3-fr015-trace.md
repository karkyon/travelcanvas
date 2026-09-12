# Gate M3 FR-015 トレーサビリティ表

- 対象: FR-015 複数経路比較(DOC-02)
- Gate: M3(backend vertical slice)
- 前提HEAD: `2d52da8a39cb8e622cde89b4e0fff494b1325646`
- 関連ADR: `docs/adr/ADR-route-options.md`

凡例: 状態は `IMPLEMENTED`(実装・検証済み) / `PARTIAL`(一部実装) /
`NOT STARTED`(未着手)。

| # | 受入条件(DOC-02 FR-015) | DB | API | model | migration | unit | ACL/security | frontend | E2E | 状態 | 証拠 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 最速・最安・乗換少・徒歩少を比較できる | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✗ | ✗ | PARTIAL | `total_duration_minutes`/`total_cost`/`transfer_count`/`walking_minutes`; `test_create_and_get_and_list_option` |
| 2 | バリアフリー・景観を比較できる | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✗ | ✗ | PARTIAL | `accessibility_score`/`scenic_score`(0-1範囲CHECK); `test_accessibility_score_out_of_range_rejected` |
| 3 | 環境負荷(CO2)を比較できる | ✓ | ✓ | ✓ | ✓ | - | - | ✗ | ✗ | PARTIAL | `co2_estimate_kg`列(nonneg CHECK) |
| 4 | 外部経路値に提供元・取得時刻・推定幅を保存する | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✗ | ✗ | PARTIAL | `provider`/`retrieved_at`/`expires_at`/`duration_estimate_low/high_minutes`; `test_duration_estimate_range_high_below_low_rejected` |
| 5 | ルート取得不能時に手動区間を登録できる | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✗ | ✗ | IMPLEMENTED | `provider="manual"`固定(外部provider未導入); `test_create_and_get_and_list_option` |
| 6 | legは順序・mode・line・operator・platform・時刻・場所・リアルタイム状態を保持する | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✗ | ✗ | PARTIAL(リアルタイムは常にunknown) | `RouteLeg`; `test_create_with_legs`, `test_add_update_delete_leg` |
| 7 | GET一覧・詳細 | - | ✓ | - | - | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | `GET /plans/{plan_id}/route-options[/{id}]`; `test_create_and_get_and_list_option`, `test_get_unknown_option_returns_404` |
| 8 | 候補の作成・更新・削除 | - | ✓ | - | - | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | `POST/PATCH/DELETE .../route-options[/{id}]`; `test_patch_and_delete_bump_plan_revision` |
| 9 | legの作成・更新・削除 | - | ✓ | - | - | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | `POST/PATCH/DELETE .../route-options/{id}/legs[/{leg_id}]`; `test_add_update_delete_leg` |
| 10 | 候補をSegmentとして採用できる(FR-014との橋渡し) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | `POST .../route-options/{id}/adopt`; `test_adopt_creates_travel_segment`, `test_adopt_twice_updates_same_segment_not_duplicate`, `test_adopt_discarded_option_rejected` |
| 11 | endpoint XOR整合性 | ✓ | ✓ | - | ✓ | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | DB CHECK `ck_route_options_from/to_endpoint_xor`; `test_endpoint_requires_exactly_one_of_event_or_place` |
| 12 | cross-plan参照の拒否 | - | ✓ | - | - | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | `test_cross_plan_event_reference_rejected` |
| 13 | 金額精度(Numeric/Decimal) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | `total_cost Numeric(14,2)`; `test_cost_with_currency_accepted_as_decimal`, `test_cost_without_currency_rejected` |
| 14 | ACL(owner/editor/viewer) | - | ✓ | - | - | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | `require_plan_access`再利用; `test_viewer_can_read_but_not_write`, `test_other_user_without_access_gets_403` |
| 15 | Idempotency-Key(POST) | - | ✓ | - | - | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | `claim_or_get_cached`再利用; `test_post_without_idempotency_key_returns_400`, `test_idempotency_replay_returns_same_resource`, `test_idempotency_key_reused_with_different_payload_returns_409` |
| 16 | If-Match/revision | - | ✓ | - | - | ✓ | ✓ | ✗ | ✗ | IMPLEMENTED | `_require_if_match`再利用; `test_patch_requires_if_match` |
| 17 | Undo対応 | - | - | - | - | - | - | ✗ | ✗ | NOT STARTED | route_option/route_legのChangeItemはUndoループ未対応(ADR §8参照) |
| 18 | frontend型定義・UI | - | - | - | - | - | - | ✗ | ✗ | NOT STARTED | 未着手(次Gate) |
| 19 | E2E | - | - | - | - | - | - | ✗ | ✗ | NOT STARTED | 未着手(次Gate) |

## 総括

- backend契約(DB/API/model/migration/unit/ACL)の大部分は IMPLEMENTED。
- リアルタイム運行情報(外部provider)、Undo対応、frontend、E2Eは
  NOT STARTED。
- DOC-02上FR-015は「SHOULD/G3-G5」(FR-014より優先度が低い)であり、
  backend縦切りの完了をもって一定の前進とするが、FR-015全体としては
  引き続き **PARTIAL** である。
