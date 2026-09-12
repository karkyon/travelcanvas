# ADR: TravelSegment(FR-014 移動区間) — Gate M1

- 対象: `karkyon/travelcanvas`
- Gate: M1(FR-014 backend vertical slice)
- 前提HEAD: `1af552e4213cf5f8258e10ac848384f0f7503a03`(Gate R3-16完了時点)
- 基準資料: DOC-02(FR-014)、DOC-03(§7 金額精度)、DOC-05 §7.1(travel_segments)、
  DOC-11 §14(expand/contract)、DOC-13(用語集: Segment/Leg/Route Option)

## 背景

Gate #32で`route_segments`テーブルと`RouteSegment` ORMを追加していたが、
1日の中で連続する2イベント間の**haversine概算のみ**を保持し、APIから一切
到達不能な内部専用テーブルだった(DOC-10監査で「SCAFFOLDED 約10%」と
評価)。本Gateは、DOC-05 §7.1が定義する正式な`travel_segments`仕様に
基づき、backendのCRUD契約を実装する。

## 決定事項

### 1. Segment / Route Option / Legの境界

DOC-13の用語定義に従い、本Gateがスコープとする`TravelSegment`は
「**採用済み**の移動区間」を表す。複数の経路候補を比較する`route_options`/
`route_legs`(FR-015)とは異なるエンティティであり、本Gateでは実装しない。
`route_option_id`のような、参照先テーブルが存在しない外部キー列も追加
しない(「テーブルが無い状態でFKなしのUUID列だけ先行追加する」設計は、
将来のFR-015実装時に型不整合や無効な参照を防げないため採用しない)。

### 2. table renameによるデータ保持(drop/recreateしない)

「`route_segments`はAPI到達不能だからdrop/recreateしても安全」という
初期案は撤回した。API参照がゼロであることは、既存DBの行数がゼロである
ことを証明しない。本Gateのmigrationは以下を満たす:

- `route_segments`を`travel_segments`へ`ALTER TABLE ... RENAME`する
  (既存PK・全行・既存10列の値を一切変更しない)。
- table名変更に伴い、Postgresが自動リネームしない index名
  (`ix_route_segments_id`)・制約名(`route_segments_pkey`ほか3本のFK)も
  明示的にcanonical名へrenameする。
- 新規列(from/to Place、planned departure/arrival、cost、currency、
  preparation/buffer、便名/platform/乗換/荷物、reservation_id、status、
  revision、updated_at)は全てnullableまたは安全なserver_defaultで追加する
  (expand)。

サンドボックスで実データ2行(walking 1件、legacy `transit` 1件)を用意し、
migration前後でID・値が完全一致することを検証した。downgrade→再upgrade
サイクルでも同じデータが保持されることを確認した。

### 3. legacy `mode='transit'`の正規化

Gate #32時点の`RouteSegment.mode`は`walking`/`driving`/`transit`の3値
のみを許容していた。FR-014の正式mode語彙(9値、下記)には`transit`が
含まれない。新しいmode CHECK制約を追加する前に、既存の`mode='transit'`
行を`mode='mixed'`へ正規化する。これは本migration中で唯一
destructiveなデータ変更だが、`transit`自体が「鉄道かバスか区別しない
概算」だったため、`mixed`への正規化で追加の情報喪失は発生しない
(downgradeでもこの正規化だけは元に戻さない。区別する情報がそもそも
残っていないため)。

### 4. pre-flightチェックによる安全なCHECK制約追加

新たに追加する制約(端点XOR、mode/status語彙、非負値、通貨書式)は、
既存行が満たさない可能性がある。CHECK制約をPostgresへ追加する前に、
明示的なSELECT COUNT(*)クエリで違反行を検査し、1件でもあれば
`RuntimeError`でmigration全体を中断する(transactional DDLにより、
それまでの列追加もロールバックされる)。サンドボックスで、
from_event_id/from_place_idが両方NULLの危険行を投入し、実際に中断・
データ保護が機能することを確認した。

### 5. 金額はNumeric、Floatを使わない

DOC-03の金額精度規約に従い、`cost`列は`Numeric(14, 2)`、APIスキーマは
Pydantic `Decimal`として扱う。`distance_km`/`duration_minutes`は既存
Gate #32からの継続でFloatのまま(概算値であり、金額のような精度要件は
無いため)。

### 6. 端点(from/to)のXOR制約

`from_event_id`/`from_place_id`のちょうど一方、`to_event_id`/
`to_place_id`のちょうど一方を要求する。DB CHECK制約と、API側の
Pydanticバリデーション(422)の両方で強制する二重防御とした。
`from`と`to`が同一のEvent/Placeを指すことも禁止する。

### 7. 参照整合性とcross-plan拒否

`from_event_id`/`to_event_id`/`reservation_id`は、対象planに所属する
ことをAPI側で検証する(他planのEvent/Reservationを指定すると422)。
`Place`はplanに属さないグローバルなエンティティのため、存在確認のみを
行う。cross-plan参照を許可可否で情報を漏らさないよう、通常の
バリデーションエラーと同じ422で応答する(既存の404→403パターンとは
別に、リクエストボディの参照検証は一貫して422とした)。

### 8. Event削除との整合性・Undo

Segment永続化後、`DELETE /plans/{plan_id}/events/{event_id}`が外部キー
違反(500)を起こしてはならない。単純な`ON DELETE SET NULL`は、
端点XOR制約(from_event_id/from_place_idのちょうど一方)を破壊するため
使えない。

採用した方式: Event削除時、そのEventを端点に持つ全TravelSegmentを
**同一トランザクション・同一ChangeSet**でEventと一緒に削除する。

実装中に2つの不具合を発見・修正した:

1. **flush順序**: `db.delete(segment)`→`db.delete(event)`の順で
   `db.delete()`を呼んでも、SQLAlchemyの自動flush順序推定に一律には
   従えず、実際にFK違反が発生するケースがあった。Segmentの削除を
   明示的に`db.flush()`してからEventを削除する2段階flushへ変更して
   解決した。
2. **Undo復元順序**: ChangeSet内の複数ChangeItem(Event 1件 +
   Segment複数件)の削除→復元は、クエリ結果の順序保証が無いため、
   Segmentの復元(delete→create)がEventより先に走るとFK違反になる。
   Undo処理を2パスに分割し、必ずtravel_event→travel_segmentの順で
   処理するよう修正した。

Undo(復元)時は、EventとSegment双方を元のPK・元の値で復元する。plan
revisionは操作全体で1だけ進む(Event削除+関連Segment削除を1つの
ChangeSetにまとめているため)。

### 9. 推奨出発時刻(recommended_departure_at)

DB正本ではなく、レスポンス時に都度算出する派生値とする。

```
arrival_basis = planned_arrival_at ?? to_event.start_at
recommended_departure_at = arrival_basis
  - duration_minutes - preparation_minutes - buffer_before_minutes
```

`arrival_basis`または`duration_minutes`が無ければ`null`とし、架空値を
作らない。`buffer_after_minutes`(到着後の余裕)はこの式へ二重加算しない
(定義上、出発時刻の算出には関与しない)。`planned_departure_at`(利用者
確定値)は推奨値で上書きしない。

### 10. Haversine fallbackとprovenance

`distance_km`/`duration_minutes`をリクエストで指定しなかった場合のみ、
既存の`app/services/route_estimator.py`(Gate #32)を再利用してfallback
する。Event自身の座標を優先し、無ければ`event.place_id`のPlace座標を
使う。座標が両端で揃わない場合は`null`のまま(架空値を作らない)とし、
`provider="unknown"`で由来を明示する。利用者が距離・時間を明示指定した
場合は`provider="manual"`、`is_estimate=false`とする。

`route_estimator.py`のmode速度・迂回係数テーブルを、既存の
walking/driving/transitの値を変更せずに9 mode(train/bus/ferry/flight/
bicycle/taxi/mixed追加)へ拡張した。

### 11. mode/status語彙

- mode: `walking`, `driving`, `train`, `bus`, `ferry`, `flight`,
  `bicycle`, `taxi`, `mixed`
- status: `planned`, `confirmed`, `cancelled`

未知の値はPydanticバリデーションで422、DB CHECK制約でも二重に強制する。

### 12. ACL・revision・Idempotency-Key・If-Match

既存の`app/api/v1/plans.py`(Day/EventのCRUD)と同じ設計を踏襲・再利用
した(重複実装しない):

- ACL: `require_plan_access`でGETはviewer以上、mutation(POST/PATCH/
  DELETE)はeditor以上を要求。guest-owned normalized planも
  `get_current_user_or_guest`により従来通り利用可能。
- 楽観ロック: `If-Match`ヘッダーで現在のplan.revisionを要求し、
  不一致は409。plans.pyの`_require_if_match`をそのまま再利用。
- 変更記録: `plans.py`の`_record_change_and_bump_revision`を再利用し、
  mutationごとにChangeSet/ChangeItemを記録、plan revisionを1つ進める。
- Idempotency-Key: POSTは必須。plans.py自体の素朴な
  `_check_idempotency`(payload fingerprint無し)はそのまま流用せず、
  Gate R2-2で実装したpayload_hash + IN_PROGRESS状態 + unique制約による
  並行性安全な`app/services/quickdraft_idempotency.py`
  (`claim_or_get_cached`/`finalize_success`/`finalize_failure`)を
  再利用した。同一key・異payloadは409 `IDEMPOTENCY_KEY_REUSED`、
  同一key・同payload処理中は409 `OPERATION_IN_PROGRESS`。

実装中、`claim_or_get_cached`のPhase B(本処理)を`db.begin_nested()`の
SAVEPOINTブロック内で行い、その中で`_record_change_and_bump_revision`
(内部で`db.commit()`する)を呼んでしまい、「Can't operate on closed
transaction」というエラーを起こす不具合を作り込んだ。
`_record_change_and_bump_revision`の呼び出しをSAVEPOINTブロックの外側
(quickdraft_idempotency.pyのPhase Bと同じ設計)へ移動して解決した。

## 検証

- migration: サンドボックスで正常系(空DB)、データ保持試験(既存2行の
  ID/値完全一致、`transit`→`mixed`正規化)、downgrade→再upgrade
  サイクル、危険系(端点XOR違反データでのpre-flight中断)を実施。
- backend: 新規`tests/test_gate_m1_travel_segments.py`(43ケース)全て
  PASS。backend全体305件(既存262件+新規43件)全てPASS(リグレッション
  なし)。
- `python -m compileall app alembic`: エラー0。

## 残件(次Gate)

- **Gate M2(frontend縦切り)**: `frontend/src/types/index.ts`への型追加、
  `frontend/src/services/api.ts`へのSegment CRUD client、Planner/Map
  画面への表示・編集UI、frontend tests、E2E。本Gate M1完了後もFR-014は
  「backend完了・frontend未接続」のためPARTIAL評価とし、Gate M2完了後に
  RELEASED候補へ上げる。
- **FR-015**: route_options/route_legs(複数経路比較)、外部Directions
  API連携、リアルタイム運行情報。
- 既存route-preview/insertion-preview(非永続プレビュー計算)と、本Gateの
  永続Segment CRUDとの統合(「プレビューから採用してSegmentを作成する」
  UIフロー)はGate M2以降で検討する。
