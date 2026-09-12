# Gate M1 FR-014 トレーサビリティ表

- 対象: FR-014 移動区間(DOC-02)
- Gate: M1(backend vertical slice)
- 前提HEAD: `1af552e4213cf5f8258e10ac848384f0f7503a03`
- 関連ADR: `docs/adr/ADR-travel-segment.md`

凡例: 状態は `IMPLEMENTED`(実装・検証済み) / `PARTIAL`(一部実装) /
`NOT STARTED`(未着手)。証拠列はfile:line、テスト名、または検証手順を示す。

| # | 受入条件(DOC-02 FR-014) | 仕様 | DB | API | model | migration | unit | integration | concurrency | security | frontend | E2E | 状態 | 証拠 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 出発・到着(場所)を保持する | DOC-05 §7.1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | ✗ | ✗ | PARTIAL | `TravelSegment.from/to_event_id, from/to_place_id`; `test_create_and_get_and_list_segment` |
| 2 | 徒歩/車/鉄道/バス/船/航空/自転車/タクシー/混合の交通手段を扱う | DOC-02 FR-014 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | ✗ | ✗ | PARTIAL | `MODES`(segments.py); `test_all_modes_accepted[*]`(9 mode全て) |
| 3 | 便名・platformを保持する | DOC-02 FR-014 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | ✗ | ✗ | PARTIAL | `transport_number`/`platform`列; `test_same_plan_reservation_reference_accepted` |
| 4 | 所要時間・距離を保持する | DOC-02 FR-014 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | ✗ | ✗ | PARTIAL | `duration_minutes`/`distance_km`; Haversine fallbackテスト群 |
| 5 | 乗換数を保持する | DOC-02 FR-014 | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | - | ✗ | ✗ | PARTIAL | `transfer_count`列(nonneg CHECK) |
| 6 | 予約(移動系)と紐付けられる | DOC-05 §7.1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✓ | ✗ | ✗ | PARTIAL | `reservation_id` FK; `test_same_plan_reservation_reference_accepted`, `test_cross_plan_reservation_reference_rejected` |
| 7 | 荷物条件を保持する | DOC-02 FR-014 | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | - | ✗ | ✗ | PARTIAL | `luggage_note`列(Text) |
| 8 | 費用・通貨を保持する(金額精度) | DOC-03 §7 | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | ✓ | ✗ | ✗ | PARTIAL | `cost Numeric(14,2)`, `currency`; `test_cost_with_currency_accepted_as_decimal`, `test_cost_without_currency_rejected`, `test_lowercase_currency_rejected` |
| 9 | 準備時間・前後バッファを保持する | DOC-05 §7.1 | ✓ | ✓ | ✓ | ✓ | ✓ | - | - | - | ✗ | ✗ | PARTIAL | `preparation_minutes`/`buffer_before/after_minutes` |
| 10 | 推奨出発時刻を移動時間+準備+余裕から算出する | DOC-02 FR-014 | - (派生値) | ✓ | - | - | ✓ | ✓ | - | - | ✗ | ✗ | PARTIAL | `_compute_recommended_departure_at`; `test_recommended_departure_uses_planned_arrival_when_present`, `test_recommended_departure_falls_back_to_event_start_at`, `test_recommended_departure_is_null_without_basis_or_duration` |
| 11 | 計算失敗時は概算であることを明示する(確定値と偽装しない) | DOC-08 v5.1 | ✓ | ✓ | ✓ | - | ✓ | ✓ | - | - | ✗ | ✗ | PARTIAL | `is_estimate`/`provider`/`algorithm_version`/`computed_at`; `test_haversine_fallback_applied_when_coordinates_available`, `test_missing_coordinates_leaves_distance_null_not_fabricated`, `test_manual_distance_marks_provider_manual` |
| 12 | GET一覧・詳細 | Gate M1範囲 | - | ✓ | - | - | ✓ | ✓ | - | ✓ | ✗ | ✗ | PARTIAL | `GET /plans/{plan_id}/segments`, `GET .../segments/{id}`; `test_create_and_get_and_list_segment`, `test_get_unknown_segment_returns_404` |
| 13 | 作成・更新・削除 | Gate M1範囲 | - | ✓ | - | - | ✓ | ✓ | - | ✓ | ✗ | ✗ | PARTIAL | `POST/PATCH/DELETE .../segments`; `test_patch_and_delete_bump_plan_revision_and_record_changeset` |
| 14 | 楽観的並行制御(revision/If-Match) | Gate M1範囲 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | PARTIAL | `revision`列; `test_patch_requires_if_match`, `test_stale_if_match_returns_409` |
| 15 | Idempotency-Key(POST) | Gate M1範囲 | - | ✓ | - | - | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | PARTIAL | `claim_or_get_cached`再利用; `test_post_without_idempotency_key_returns_400`, `test_idempotency_replay_returns_same_resource`, `test_idempotency_key_reused_with_different_payload_returns_409` |
| 16 | ACL(owner/editor/viewer) | Gate M1範囲 | - | ✓ | - | - | ✓ | ✓ | - | ✓ | ✗ | ✗ | PARTIAL | `require_plan_access`再利用; `test_viewer_can_read_but_not_write`, `test_editor_can_write`, `test_other_user_without_access_gets_403` |
| 17 | guest-owned plan契約の維持 | 既存契約 | - | ✓ | - | - | ✓ | ✓ | - | ✓ | ✗ | ✗ | PARTIAL | `get_current_user_or_guest`; `test_guest_owner_can_crud_segments` |
| 18 | Event/Place端点のXOR整合性 | ADR §6 | ✓ | ✓ | - | ✓ | ✓ | ✓ | - | ✓ | ✗ | ✗ | PARTIAL | DB CHECK `ck_travel_segments_from/to_endpoint_xor`; `test_endpoint_requires_exactly_one_of_event_or_place`, `test_from_and_to_cannot_be_same_event`, `test_place_endpoint_accepted` |
| 19 | cross-plan参照の拒否 | ADR §7 | - | ✓ | - | - | ✓ | ✓ | - | ✓ | ✗ | ✗ | PARTIAL | `_resolve_event_ref`/`_resolve_reservation_ref`; `test_cross_plan_event_reference_rejected`, `test_cross_plan_reservation_reference_rejected` |
| 20 | Event削除時のSegment整合性(FK違反防止) | ADR §8 | ✓ | ✓ | - | ✓ | ✓ | ✓ | - | - | ✗ | ✗ | PARTIAL | `delete_event`のcascade削除(plans.py); `test_deleting_event_cascades_segment_deletion` |
| 21 | Undo(Event削除→Segment復元) | ADR §8 | - | ✓ | - | - | ✓ | ✓ | - | - | ✗ | ✗ | PARTIAL | `_undo_segment_item`; `test_undo_after_event_delete_restores_event_and_segment` |
| 22 | 既存route_segmentsデータの保持(rename migration) | ADR §2 | ✓ | - | - | ✓ | - | ✓(サンドボックス) | - | - | - | - | IMPLEMENTED | migration `5bf5b47a715d`; サンドボックス実データ検証(件数・ID・値完全一致、downgrade→再upgrade) |
| 23 | 未backfillデータに対する安全なmigration中断 | ADR §4 | ✓ | - | - | ✓ | - | ✓(サンドボックス) | - | ✓ | - | - | IMPLEMENTED | pre-flightチェック; サンドボックスで端点XOR違反データを用いた中断検証 |
| 24 | legacy `mode='transit'`の正規化 | ADR §3 | ✓ | - | - | ✓ | - | ✓(サンドボックス) | - | - | - | - | IMPLEMENTED | migration内`UPDATE ... SET mode='mixed'`; サンドボックス実データ検証 |
| 25 | frontend型定義・APIクライアント | Gate M2 | - | - | - | - | ✓ | - | - | - | ✓ | ✗ | IMPLEMENTED | `api.ts` TravelSegment型/CRUD client; `api.test.ts` TravelSegment API client(5ケース) |
| 26 | Planner/Map画面でのSegment表示・編集UI | Gate M2 | - | - | - | - | - | - | - | - | ✓ | ✗ | IMPLEMENTED | `SegmentsPage.tsx`(一覧・作成・編集・削除)、`router/index.tsx`、`PlannerPage.tsx`のボタン導線 |
| 27 | frontend tests / E2E | Gate M2 | - | - | - | - | ✓ | - | - | - | ✓ | ✗ | PARTIAL | `api.test.ts`単体テスト5件PASS(62→67件、リグレッションなし)。E2Eは未着手(次Gate候補) |

## 総括

- backend契約(DB/API/model/migration/unit/integration/concurrency/security)は
  全項目 IMPLEMENTED または検証済み。
- frontend: 型定義・APIクライアント・Planner画面へのUI導線は IMPLEMENTED。
  E2Eのみ PARTIAL(未着手)。
- Place端点のfrontend選択UI(候補一覧からの選定導線)、FR-015
  (route_options/route_legs)は引き続き未着手。
- FR-014全体の評価は、E2E・Place端点UIが残るため引き続き **PARTIAL**
  とするが、Gate M1(backend)・Gate M2(frontend基本UI)の完了により
  実際の画面から作成・編集・削除・閲覧が可能な状態に到達した。
