# ADR: 予約管理(FR-010) 最小実装（Gate R3-0）

- 状態: ACCEPTED
- 日付: 2026-09-09
- 対象: Gate R3-0（`reservations`最小CRUD）
- 正本: DOC-02 FR-010/FR-011/FR-012/FR-021, DOC-05 §6.1/§18.1/§19, DOC-04 §9 SC-11, DOC-11
- 調査基準HEAD: `793c8eb1b6f57b9f7c361ab309773fd42d74b800`

## 背景

DOC-10のFR-010静的評価は「SCAFFOLDED 5%」であり、実体は
`backend/app/schemas/schemas.py`の`EventCreate`/`EventUpdate`が持つ
`booking_url`(任意URL文字列)フィールド1件のみだった。独立cloneでの
grep調査により、`Reservation`モデル・`reservations`テーブル・関連APIが
一つも存在しないことを確認した(DOC-10評価通りであり、想定と異なる
「ゴーストスキーマ」ではなく単純な未着手)。

DOC-05 §6.1が定義するreservationsのフル仕様は以下を要求する。

- confirmation_number/pin/holder_name/contact_phoneのKMS envelope暗号化
  (per-value data key、鍵ローテーション)と盲検索index(`lookup_hash`)
- `event_reservations`多対多中間表(1予約が複数イベントに紐付く連泊等)
- `reservation_participants`(参加者別の氏名・座席・special request)
- `tickets`(QR/バーコード等のペイロード)
- `import_jobs`/`extraction_candidates`(メール・PDF・画像からのOCR取込)

これらを一度に実装するのは中〜大規模スコープであり、DOC-02 §1.1
「画面だけ、APIだけ、DBだけ存在する状態は完成としない」という完成定義
を満たすためには、狭くとも縦切りで完結させる方が安全と判断した。

## 決定事項

### 1. スコープをDB+基本CRUD APIに限定する

本Gateで実装するのは以下のみ。

- `reservations`テーブル(単一テーブル。中間表・participants・tickets・
  import_jobsは含まない)
- `POST/GET/PATCH/DELETE /api/v1/plans/{plan_id}/reservations[/{id}]`
- `POST /api/v1/plans/{plan_id}/reservations/{id}/reveal`
  (confirmation_number/pinの完全開示。owner/editor限定、監査ログ必須)

次Gate以降のスコープ(本Gateでは着手しない):
`reservation_participants`、`tickets`、`import_jobs`/`extraction_candidates`
(FR-011予約取込)、複数イベント紐付け(`event_reservations`中間表)、
盲検索index(`lookup_hash`)。

### 2. 暗号化はGate R2-2のFernet field encryptionを再利用する

DOC-11本来の要求はKMS envelope encryption(per-value data key、鍵
ローテーション)だが、TravelCanvasには現時点でKMS連携が存在しない。
Gate R2-2でQuickDraftのpayload_ciphertext用に導入済みの
`app/core/crypto.py`(`ENCRYPTION_KEY`ベースのFernet対称鍵暗号化)を
confirmation_number/pinへ再利用する。これはQuickDraftと同じ意図的な
スコープ限定であり、KMS envelope encryptionへの移行は将来のfollow-up
とする(ADR-quick-draft.md §8と同じ位置づけ)。

holder_name/contact_phoneは平文カラムとする。これらは共同編集者へ
通常表示される情報であり、confirmation_number/pinほどの機微性を
持たないと判断した。将来暗号化列へ移行する場合もadditive migrationで
対応可能な設計としている。

### 3. event_reservations中間表を設けず、reservations.event_idの単一FKとする

DOC-05は多対多を許容する設計だが、本Gateでは「1予約=最大1イベント」に
限定する。連泊等で複数の`TravelEvent`に同一予約を紐付けたいケースは
次Gate以降で中間表として追加する(reservations側の変更は不要、additive)。

### 4. 権限モデルはGate #30の`plan_access.py`をそのまま利用する

DOC-04 §9 SC-11マトリクスは owner/editor/viewer/share の4区分だが、
既存の`require_plan_access()`が扱うロールは owner > editor > viewer の
3区分のみ(共有リンク経由の閲覧は`public_share.py`が別途扱う)。本Gateは
既存の3区分にそのまま従う。

- 作成/更新/削除/reveal: `min_role="editor"`
- 閲覧(一覧・詳細): `min_role="viewer"`。ただしconfirmation_number/pinは
  レスポンスに含めず、`confirmation_number_masked`(末尾4文字のみの
  簡易マスク)と`has_pin`(真偽値)のみを返す。
- revealはowner/editor限定とし、`record_audit_event()`で
  `action="reservation_revealed"`を必ず記録する(DOC-05 §18.1)。

viewerへのreveal許可、および共有リンク経由でのreservation閲覧APIは
次Gate以降のスコープとする(DOC-02 FR-021「予約番号・実位置・RESTRICTED
資料は共有リンクで既定非公開」の方針を優先し、本Gateでは共有リンク
経由のreservation公開自体を実装しない)。

### 5. 楽観ロックは既存`If-Match`パターンを踏襲する

`TravelPlan.revision`とは独立に、`Reservation.revision`自体を対象とした
`If-Match`ヘッダー必須方式とする(`app/api/v1/plans.py`の
`_require_if_match`と同じ設計。作成はIf-Match不要、更新・削除は必須)。

## 検証

- サンドボックス(PostgreSQL 16 + venv)で`alembic upgrade head`が成功し、
  alembic headが`c1e9a274b56d`(down_revision=`9f0906d65cdc`)の単一headに
  なることを確認した。
- 新規`tests/test_gate_r3_0_reservation.py`(7ケース: 作成時マスク表示、
  一覧、reveal+監査呼び出し検証、If-Match必須/409/成功、soft
  delete、他ユーザー403、viewerの作成拒否)が全てPASS。
- 既存backendテストスイート全体(184件、Gate R3-0追加分含む)がPASS。
  リグレッションなし。
- omega-dev2実行時にdocker composeでのbackend pytest(専用test DB)・
  frontend側への影響有無(本Gateはbackendのみでfrontend変更なし)を
  パッチスクリプト内で再検証する。

## 次にやるべきこと(次Gate候補)

1. `reservation_participants`(参加者別氏名等)の追加
2. `event_reservations`中間表への移行(複数イベント紐付け)
3. `tickets`(QR/バーコード)
4. `import_jobs`/`extraction_candidates`(FR-011予約メール・文書取込)
5. `lookup_hash`による盲検索index(DOC-11 §6.3)
6. frontend側UI(Event Detail DrawerのReservationセクション、DOC-04 §11)
