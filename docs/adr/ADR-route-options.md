# ADR: RouteOption / RouteLeg(FR-015 複数経路比較) — Gate M3

- 対象: `karkyon/travelcanvas`
- Gate: M3(FR-015 backend vertical slice)
- 前提HEAD: `2d52da8a39cb8e622cde89b4e0fff494b1325646`(Gate M2改訂完了時点)
- 基準資料: DOC-02(FR-015)、DOC-03(§7 金額精度)、DOC-05 §7.2(route_options/
  route_legs)、DOC-13(用語集: Segment/Leg/Route Option)

## 背景

FR-014(移動区間、Gate M1/M2)は「採用済み」の単一移動区間
(`TravelSegment`)のみを扱う。FR-015は、採用前に複数の経路候補
(最速・最安・乗換少・徒歩少・バリアフリー・景観・環境負荷等)を比較する
機能であり、Gate M1のADRで意図的にスコープ外としていた
`route_options`/`route_legs`(DOC-05 §7.2)を実装する。

## 決定事項

### 1. RouteOption(候補)とTravelSegment(採用済み)の橋渡し

Gate M1時点では`route_option_id`列は「参照先テーブルが無い状態でFKなし
のUUID列だけ先行追加しない」という方針により保留していた。本Gateで
`route_options`テーブルを新設し、`travel_segments.route_option_id`
(nullable FK)をadditiveに追加した。

候補の作成・比較 → `POST .../route-options/{id}/adopt`で採用、という
一方向のライフサイクルとする。adoptは:

- 既にそのRouteOptionから採用済みのTravelSegmentが存在すれば更新する
  (二重adoptで重複Segmentを作らない)。
- 存在しなければ新規TravelSegmentを作成し、`route_option_id`で
  RouteOptionを指す。
- RouteOption自体のstatusを`adopted`へ遷移させる。
- これら2エンティティの変更を`_record_batch_change_and_bump_revision`
  で1つのChangeSetにまとめ、plan revisionを1つだけ進める(Gate M1の
  Event削除cascadeと同じパターン)。

### 2. 外部providerは未導入、manualのみ

DOC-02「ルート取得不能時は手動区間を登録できる」に対応し、本Gateでは
`provider="manual"`のみをサポートする。DOC-05が要求する
`retrieved_at`/`expires_at`/推定幅(`duration_estimate_low/high_minutes`)
の列は用意したが、外部provider実装(APIキー取得後)は将来Gateへ委ねる。

### 3. RouteOptionの端点はTravelSegmentと同じXORパターン

`from_event_id`/`from_place_id`、`to_event_id`/`to_place_id`のちょうど
一方を要求するCHECK制約・API検証は、Gate M1のTravelSegmentと同一の
設計を踏襲した(`app/api/v1/segments.py`の`_validate_endpoint_shape`/
`_resolve_event_ref`/`_resolve_place_ref`/`_apply_haversine_fallback`を
そのままimportして再利用し、重複実装しない)。

### 4. RouteLegのfrom/toは自由記述ラベル

RouteLeg(候補内の個別乗り継ぎ区間)の`from_label`/`to_label`は、
TravelEvent/Placeのような正式エンティティへの参照ではなく自由記述の
文字列とした。経路候補の途中経由地(乗換駅など)は、必ずしも
TravelEvent/Placeとして正式登録されているとは限らないため。

### 5. RouteLegの順序保証

`(route_option_id, leg_order)`のUNIQUE制約で、同一候補内の順序重複を
防ぐ。leg追加時は既存leg数をそのまま次のleg_orderとして採番する
(末尾追加のみサポートし、途中挿入・並べ替えは本Gateでは実装しない)。

### 6. 金額・スコアの型

`total_cost`はGate M1と同じくNumeric(14,2)/Decimal。
`accessibility_score`/`scenic_score`は0.0-1.0の範囲(DB CHECK制約と
Pydantic `ge=0, le=1`の二重検証)。

### 7. ACL・revision・Idempotency-Key・If-Match

Gate M1のSegment APIと同一パターンをそのまま再利用した:
`require_plan_access`(GET=viewer以上、mutation=editor以上)、
`_require_if_match`(plan revisionベースの楽観ロック)、
`_record_change_and_bump_revision`/`_record_batch_change_and_bump_revision`
(ChangeSet記録)、`quickdraft_idempotency`の`claim_or_get_cached`
(POST必須のIdempotency-Key、payload_hash+並行性安全)。

### 8. 既知の制約: Undo未対応

`entity_type="route_option"`/`"route_leg"`のChangeItemは記録するが、
`app/api/v1/plans.py`の`undo_last_change`ループはこれらのentity_typeを
まだ処理しない(travel_day/travel_event/travel_segmentのみ対応)。
そのため、RouteOption/RouteLegの作成・更新・削除、および`adopt`操作は
**Undoで復元できない**(黙って無視される。エラーにはならないが、
ユーザーが期待する復元は行われない)。

FR-015はDOC-02上「SHOULD/G3-G5」(FR-014の「MUST/G2-G3」より優先度が
低い)であり、Undo対応は次Gateの残件とする。adopt操作でTravelSegmentの
Undoだけ効いてRouteOptionのstatusが`adopted`のまま取り残される、という
部分的な不整合が起き得ることを明記しておく。

### 9. frontend・E2Eは本Gateのスコープ外

Gate M1→M2と同じ段階分けとし、本GateはFR-015のbackend契約のみを実装
する。frontend型定義・UI・E2Eは将来のGate(M4相当)で実施する。

## 検証

- migration: サンドボックスで新規テーブル2本の作成、CHECK制約付き
  (端点XOR、mode/status/realtime語彙、非負値、スコア範囲、通貨書式)、
  `travel_segments.route_option_id`のadditive追加を確認。既存
  データへの影響が無いことを確認(新規テーブルのみでrename等は不要)。
- backend: 新規`tests/test_gate_m3_route_options.py`(22ケース: CRUD、
  ACL、endpoint XOR、cross-plan拒否、費用/スコア検証、Idempotency-Key、
  If-Match、leg CRUD、adopt→Segment作成/更新/二重adopt防止/discarded
  拒否、レスポンス非露出)全てPASS。
- 実装中に2件の不具合を発見・修正した:
  1. `_option_to_response`で生の辞書へ`jsonable_encoder`を直接適用した
     ため、Decimal(`total_cost`)がPydanticモデルの型変換を経由せず
     floatへ変換されてしまっていた(`"1234.50"`ではなく`1234.5`)。
     Gate M1の`SegmentResponse`はPydanticモデル経由で
     `jsonable_encoder(SegmentResponse(**body))`としていたためこの
     問題が起きなかった。`total_cost`を`str()`変換してから
     辞書に入れることで解決した。
  2. `TravelSegment`モデルに`route_option_id`列を追加したにも関わらず、
     Gate M1の`SegmentResponse`(Pydanticモデル)・`_to_response`
     (segments.py)・`_segment_to_dict`(plans.py、Undo用)に
     この新列を反映し忘れており、adoptで作成したSegmentの
     `route_option_id`がAPIレスポンスに一切現れなかった。3箇所を
     修正して解決した(Gate M1のテスト`test_response_does_not_leak_internal_fields`
     の許可フィールド一覧も同時に更新)。
- backend全体327件(既存305件+新規22件)全てPASS(リグレッションなし)。
- `python -m compileall app alembic`: エラー0。

## 残件(次Gate)

- Undo対応(route_option/route_legのChangeItem復元)。
- 外部Directions API等の実providerの追加。
- leg並べ替え・途中挿入。
- E2E。

## 改訂: Gate M4(frontend接続)

Gate M3のbackend契約を、実際の画面から到達可能にした(Gate M1→M2と
同じ段階分け)。

### 実施内容

- `frontend/src/services/api.ts`: `RouteOption`/`RouteLeg`/
  `RouteOptionCreateData`/`RouteOptionUpdateData`/`RouteLegCreateData`/
  `RouteLegUpdateData`/`AdoptRouteOptionResponse`型、および
  `getRouteOptions`/`getRouteOption`/`createRouteOption`
  (Idempotency-Key付き)/`updateRouteOption`/`deleteRouteOption`/
  `addRouteLeg`/`updateRouteLeg`/`deleteRouteLeg`/`adoptRouteOption`
  (If-Match付き)をGate M2のSegment APIと同じパターンで追加。
- `frontend/src/pages/RouteOptionsPage.tsx`新規: 候補一覧(所要時間/
  距離/費用/乗換/徒歩時間/バリアフリー/景観/CO2の比較指標表示、
  採用済み/見送りバッジ、leg一覧の簡易表示)、候補作成モーダル、
  削除、採用(adopt)ボタン。
- `frontend/src/router/index.tsx`: `/planner/:planId/route-options`
  ルート追加。
- `frontend/src/pages/PlannerPage.tsx`: 「🗺️ 経路の比較」ボタン追加。

### スコープ判断

- leg(乗り継ぎ区間)の追加・編集UIは本画面では簡易表示のみとし、
  詳細な追加・編集フォームは次Gateへ送った(候補自体の比較・採用が
  FR-015の中核機能であり、legはbackend契約上は既に完備しているため、
  UI側の優先度を候補比較に絞った)。
- Place端点の選択はSegmentsPage(Gate M2改訂)と同様の制約を持つ
  (backendにPlaceのplan横断一覧APIが無いため)。本画面ではさらに
  簡略化し、Event端点のみをUIから選択可能とした。

### 検証

- `npm install`後、変更前のbaseline(vitest 67件PASS、`tsc --noEmit`
  エラー0)を確認してから着手した。
- `frontend/src/services/api.test.ts`にRouteOption APIクライアントの
  単体テスト6件を追加。
- 変更後: `tsc --noEmit`エラー0、`vitest run` 73件PASS(67+6、
  リグレッションなし)、`vite build`成功を確認。
- backend側は無変更のため327件PASSを再確認するに留めた。

### 残件(更新)

- leg詳細編集UI、Undo対応、外部Directions API連携、leg並べ替え、E2E。
