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

---

## 改訂: Gate R3-1（2026-09-09）

DOC-05 §6.3の`reservation_participants`を追加した。設計判断:

- `name`/`seat`/`special_request`は平文カラムとする(Gate R3-0の
  `holder_name`/`contact_phone`と同じ理由。予約閲覧権限を持つ共同編集者
  へ通常表示される情報であり、confirmation_number/pinほどの機微性を
  持たないと判断)。
- `plan_member_id`は`PlanCollaborator.id`へのFK(nullable)とする。
  DOC-05は汎用的に「plan_member_id」と書いているが、本コードベースには
  独立した`plan_members`テーブルが無く(owner=`TravelPlan.user_id`、
  招待済みメンバー=`PlanCollaborator`、Gate #30)、参加者は必ずしも
  planのメンバーとは限らない(同行する未登録の子供・同僚等)ため
  nullableとした。
- DOC-05 §6.3「アクセスは予約権限＋本人条件を評価」のうち、本人
  (plan_member本人)によるセルフサービス編集は次Gateスコープとし、
  本Gateでは予約と同じowner/editor(書き込み)・viewer以上(閲覧)に
  単純化した。

エンドポイント: `POST/GET /api/v1/plans/{plan_id}/reservations/{id}/participants`、
`PATCH/DELETE .../participants/{participant_id}`(soft delete)。

検証: サンドボックスでmigration適用(alembic head `d2f6b385c917`、単一head)、
新規4テスト含めbackend全188件PASS、独立clone再検証は今後の実サーバー
適用後に実施予定。

次Gate候補: `event_reservations`中間表、`tickets`、FR-011予約取込、
参加者本人によるセルフサービス編集、frontend UI。

---

## 改訂: Gate R3-3（2026-09-09）

DOC-05 §6.2の`event_reservations`中間表を追加した。設計判断:

- 既存の`Reservation.event_id`(単一FK、Gate R3-0)は削除・非推奨化しない
  (additive only。既存frontend `ReservationsPage.tsx`との後方互換を保つ
  ため)。予約作成・更新時に`event_id`が指定されると、
  `relation_type="primary"`の`event_reservations`リンクを自動同期作成する
  (`_sync_primary_event_link()`)。既存の複数リンクには一切触れない。
- migrationは新規テーブル作成に加え、既存`reservations.event_id`を持つ
  行から`primary`リンクをバックフィルする(Gate #29の慣習に合わせ
  `uuid.uuid4()`をPython側で採番。`gen_random_uuid()`等のDB拡張機能には
  依存しない)。
- 追加リンク専用エンドポイント(`POST/GET/PATCH/DELETE
  .../reservations/{id}/events[/{link_id}]`)を新設。紐付け先イベントは
  同一plan内であることを検証(404)、重複リンクは409。
- `is_locked=True`のリンクは解除(DELETE)を拒否する(409)。確定済みの
  複数日紐付けを誤操作から保護する簡易ガードであり、DOC-05は
  `is_locked`の意味を明記していないため、本Gateでは「解除保護フラグ」
  として解釈した(将来DOC-05側で異なる意味が明確化された場合は追随する)。
- 中間表自体は`deleted_at`を持たず、リンク解除はハード削除とする(予約
  本体・参加者と異なり、リンクは監査上の履歴価値を持たない単純な関連
  情報と判断)。

エンドポイント: `POST/GET /api/v1/plans/{plan_id}/reservations/{id}/events`、
`PATCH/DELETE .../events/{link_id}`。権限は既存予約と同じ
owner/editor(書き込み)・viewer以上(閲覧)。

検証: サンドボックス(PostgreSQL 16 + venv、本Gateから新規構築)で
`alembic upgrade head`成功、alembic headが`a7c3e561f890`
(down_revision=`d2f6b385c917`)の単一headになることを確認。新規
`tests/test_gate_r3_3_event_reservations.py`(8ケース: primaryリンク
自動作成、連泊時の追加リンク、重複409、他plan所属イベント404、
relation_type/is_locked更新、リンク解除、ロック済みリンク解除拒否409、
他ユーザー403)全てPASS。既存backend全テスト含め196件全てPASS
(リグレッションなし)。

次Gate候補: frontend UI(`ReservationsPage.tsx`への複数イベント紐付け
表示・連泊UI追加)、`tickets`、FR-011予約取込、
`reservation_participants`/`holder_name`/`contact_phone`の暗号化列化、
`lookup_hash`による盲検索index。

---

## 改訂: Gate R3-8（2026-09-09）

DOC-05 §6.1/§6.3が本来要求するholder_ciphertext/contact_phone_
ciphertext/reservation_participants.name_ciphertext等の暗号化を実装
した(Gate R3-0/R3-1で意図的にスコープ限定していたholder_name/
contact_phone/name/seat/special_requestの平文カラム運用を解消)。

- DOC-11 §14「暗号化移行は二重読取・新規暗号化・再暗号化・旧列削除」の
  expand/contractパターンのうちexpand(新列追加+backfill)のみを実施。
  旧平文列(`holder_name`/`contact_phone`/`name`/`seat`/
  `special_request`)はadditive only原則により削除せず、後方互換の
  ため残す(将来の非additiveメンテナンスGateでcontract(旧列削除)を
  実施する想定)。
- 以後の作成・更新はciphertext列のみへ書き込む(旧平文列は新規行では
  常にNULLのまま)。
- migration内でGate R2-2と同じ`app/core/crypto.py`のFernet暗号化を
  用いて既存データをbackfillする。`ENCRYPTION_KEY`未設定環境では
  backfillをスキップし警告を出力するのみとし、migration自体は失敗
  させない(既存の`EncryptionNotConfigured`許容パターンを踏襲)。
- レスポンスは`ciphertext`列を優先して復号し、無ければ旧平文列へ
  フォールバックする(`_decrypt_or_none(...) or 旧平文値`)。これにより
  backfill未実施の既存データも引き続き表示できる。
- `reservation_participants.name`は元々NOT NULL制約だったが、新規行
  では書き込まなくなるためnullableへ緩和した(データそのものは失わない
  安全な変更)。
- Gate R3-7(`imports.py`)のconfirm処理も同様にholder_name/
  contact_phoneをciphertext列へ書き込むよう追随した。

検証: サンドボックスで`alembic upgrade head`成功、alembic headが
`e6b2c847a1d9`(down_revision=`d3e5f9a1b264`)の単一headになることを
確認。新規`tests/test_gate_r3_8_field_encryption.py`(5ケース:
holder_name/contact_phone暗号化保存、update時のciphertext限定書き込み、
backfill前レガシー行のフォールバック読み取り、participant fields暗号化
保存、participant update時のciphertext限定書き込み)全てPASS。
downgrade→生SQLでの平文データ投入→upgradeによりbackfillが実データに
対して正しく暗号化・復号できることも個別に検証済み。既存
`test_gate_r3_1_reservation_participants.py`の1件(DB直接検証で平文を
期待していたテスト)をciphertext保存を前提とする内容へ更新。既存
backend全テスト含め226件全てPASS(リグレッションなし)。

次Gate候補: `lookup_hash`による盲検索index(DOC-11 §6.3)、
frontend UI(取込ジョブ一覧・候補レビュー画面、チケットQR表示)、
`documents`のObject Storage実連携、旧平文列のcontract(削除)。

---

## 改訂: Gate R3-5（2026-09-09）

DOC-05 §6.4の`tickets`(FR-012 QR・チケット)を追加した。設計判断:

- `display_document_id`(DOC-05 §6.5 `documents`テーブルへの参照)は、
  `documents`テーブル自体が本コードベースに未実装(FR-013文書ウォレット、
  次Gate候補)のため、外部キー制約無しのnullable UUID列として先行定義
  するのみとした。additive migrationで後日FK制約を追加可能。
- DOC-05 §8の制約「payloadまたはdocumentの少なくとも一方」は、
  `display_document_id`が実質使えない本Gateでは検証しない(payload必須
  として運用する想定。DB CHECK制約としては実装していない)。
- `payload_ciphertext`(QR/バーコード生データ)はGate R2-2/R3-0と同じ
  Fernet field encryptionを再利用。
- `share_policy`(DOC-05に値の明記が無いため本Gateで定義): 既定
  `owner_editor`(owner/editorのみreveal可)、`all_collaborators`
  (viewerも含め全員reveal可)の2値。revealエンドポイントは
  `share_policy`に応じて必要ロールを動的に判定する。
- `status`(DOC-05に値の明記が無いため本Gateで定義): active/used/
  expired/revokedの4値。
- DB CHECK制約: `valid_from < valid_to`(両方設定時のみ、DOC-05 §8)。
- 権限: 作成/更新/削除はowner/editor、閲覧(一覧・詳細)はviewer以上
  (payloadは`has_payload`真偽値のみ返しmaskする)。revealはshare_policy
  依存、呼び出しを`record_audit_event()`で監査ログに残す。

エンドポイント: `POST/GET /api/v1/plans/{plan_id}/reservations/{id}/tickets`、
`GET/PATCH/DELETE .../tickets/{ticket_id}`、`POST .../tickets/{ticket_id}/reveal`。

検証: サンドボックスで`alembic upgrade head`成功、alembic headが
`b48d9f2c6e17`(down_revision=`a7c3e561f890`)の単一headになることを確認。
新規`tests/test_gate_r3_5_tickets.py`(8ケース: 作成時マスク表示、一覧・
詳細、reveal+監査呼び出し検証、If-Match必須/409/成功、soft delete、
share_policy既定でのviewer 403、share_policy=all_collaboratorsでの
viewer許可、他ユーザー403)全てPASS。既存backend全テスト含め204件
全てPASS(リグレッションなし)。

次Gate候補: `documents`/`document_links`(FR-013文書ウォレット。実装後は
`tickets.display_document_id`へFK制約追加)、FR-011予約取込
(`import_jobs`/`extraction_candidates`)、
`reservation_participants`/`holder_name`/`contact_phone`の暗号化列化、
`lookup_hash`による盲検索index、frontend UI(チケット表示・QRコード
レンダリング)。

---

## 改訂: Gate R3-13（2026-09-09）

DOC-11 §6.3 / DOC-08 §19が要求する`lookup_hash`による盲検索(blind index)
を実装した(Gate R3-3のADR本文で次Gateスコープとしていた項目、Gate R3-8
改訂の§5でも「次にやるべきこと」の1番目として引き継がれていた)。

### 背景

`confirmation_number`はGate R3-0からFernet field encryption(暗号文)
として保存されており、DB側で平文WHERE検索・LIKE検索が一切できない。
利用者が「あの予約番号の予約を探したい」という操作を行うための手段が
存在しなかった。

### 決定事項

1. **完全一致検索のみをサポートする(末尾検索は対象外)**。DOC-03 §7
   「予約番号検索が必要な場合、暗号文に加えて限定的なblind indexを保持
   する。blind indexは漏洩リスクを評価し、完全一致または末尾検索だけに
   制限する」とあるうち、本Gateでは完全一致側のみを実装する。POC-03は
   「末尾検索」も要求しているが、末尾検索用のblind indexは末尾N文字を
   別途HMAC化した専用索引が必要であり(完全一致用の索引を流用できない)、
   スコープ拡大となるため次Gateへ送る。
2. **鍵をENCRYPTION_KEYと分離する**。DOC-08 §19「Lookup: HMAC blind
   index、用途別key」に従い、新規設定`LOOKUP_INDEX_KEY`を導入した。
   データ暗号化用の鍵とは独立させることで、一方の鍵が漏洩してももう
   一方の保護には影響しない設計とする。
3. **正規化を固定する**。`confirmation_number`の表記ゆれ(大文字小文字・
   前後空白)を許容するため、HMAC計算前に`strip()+upper()`で正規化する
   (`app/core/crypto.py normalize_lookup_value`)。登録経路(作成/更新)
   と検索経路の両方が同じ正規化を必ず経由するため、実装上は
   `compute_lookup_hash()`内に正規化を内包し、呼び出し側が正規化を
   意識しなくても一致するようにした。
4. **LOOKUP_INDEX_KEY未設定時は検索機能のみを503にする(作成・更新は
   妨げない)**。ENCRYPTION_KEYと異なり、confirmation_number自体の
   保存(暗号化)には影響しない付加的な索引であるため、鍵未設定時に
   予約の作成・編集そのものをブロックすると既存機能への破壊的変更に
   なってしまう。索引が空のままの予約は単に検索対象から漏れるだけ
   とし、後から鍵を設定してbackfill migrationを再実行すれば解消できる
   設計とした。
5. **APIレスポンスには`confirmation_number_lookup_hash`を一切含めない**。
   `ReservationResponse`に対応フィールドを追加していない(内部的な
   検索索引専用。DOC-04 §4 用語集の「Blind Index」定義通り、平文を
   保存しないための限定検索用索引であり、UIに露出する情報ではない)。
6. **検索エンドポイントの権限・スコープ**。
   `GET /api/v1/plans/{plan_id}/reservations/search?confirmation_number=...`
   とし、既存の一覧・詳細と同じ`viewer`以上の権限、かつ`plan_id`配下に
   スコープする(他planの予約はヒットしない。全plan横断検索は対象外)。
   FastAPIのルーティング順序上、`/reservations/search`は
   `/reservations/{reservation_id}`より前に定義する必要があり(でないと
   "search"がUUID相当のreservation_idとして解釈されてしまう)、本Gateの
   実装でもその順序を守っている。

### migrationとbackfillで見つかった不具合と修正

migrationのbackfillロジックは、既存の`confirmation_number_ciphertext`
を復号して`compute_lookup_hash()`を計算する処理だが、`op.get_bind()`
経由の生SQL(`bind.execute(sa.text(...))`)で取得した`bytea`列は
psycopg2上`memoryview`として返り、`Fernet.decrypt()`は`bytes`/`str`
以外を受け付けず`TypeError: token must be bytes or str`で失敗する
ことをサンドボックス検証で発見した(Gate R3-8のbackfillは`encrypt_payload`
のみを使っており、この経路の問題が顕在化していなかった)。
`bytes(row.confirmation_number_ciphertext)`による明示的な型変換を追加
して解消した。alembicのtransactional DDLにより、修正前の失敗時も
DB状態は自動的にロールバックされ、破損した中間状態は残らないことを
併せて確認した。

### 検証

サンドボックス(PostgreSQL 16 + venv、既存DBを再利用)で
`alembic upgrade head`成功、alembic headが`5d57e3208d2a`
(down_revision=`e6b2c847a1d9`)の単一headになることを確認。

新規`tests/test_gate_r3_13_lookup_hash.py`(10ケース: 完全一致検索、
正規化(大文字小文字・前後空白)一致、未一致時の空リスト、confirmation_number
未指定400、更新時のlookup_hash更新(旧番号でヒットしなくなり新番号で
ヒットする)、クリア時のlookup_hash削除、APIレスポンス(作成/一覧/検索)
への`confirmation_number_lookup_hash`非露出、plan間のスコープ分離、
他ユーザー403、LOOKUP_INDEX_KEY未設定時の検索503)全てPASS。既存
backend全テスト含め236件全てPASS(リグレッションなし)。

さらに、ORM経由ではなく実際に暗号文のみを持つダミー予約行を直接投入し、
`alembic downgrade -1`→`alembic upgrade head`のサイクルで
backfillロジック自体を実データで検証した(復号→正規化→HMAC計算した
値が、アプリケーション側の`compute_lookup_hash()`の期待値と完全一致
することを確認)。この検証中に上記のmemoryview/bytes不一致の不具合を
発見・修正している。

### 次Gate候補

末尾検索用の専用blind index(末尾4桁等をHMAC化した別列)、
`reservation_participants`側の氏名検索、DOC-10監査の継続
(FR-046画像/PDF出力等)、旧平文列(`holder_name`/`contact_phone`/
`name`/`seat`/`special_request`)のcontract(削除)、Object Storage
実連携。

---

## 改訂: Gate R3-14（2026-09-09）

Gate R3-13で次Gateスコープとしていた「末尾検索用の専用blind index」を
実装した。DOC-04 SC-10「予約番号は末尾検索を可能にしても結果画面では
マスクする」、SC-17「予約番号: 既定表示=末尾4桁」、POC-03「blind index
で予約番号末尾検索」に対応する。

### 決定事項

1. **末尾4文字固定**。SC-17の既定マスク表示("****1234")が末尾4桁を
   露出している設計と単位を揃え、末尾検索も4文字固定とした。可変長に
   すると「何文字から検索できるか」がUIの一貫性を崩し、また短い桁数を
   許すほど実質的に完全一致検索へ近づき秘匿性が下がるため、固定長を
   採用した。
2. **完全一致索引とは別列・別ドメインのHMAC**。同じ`LOOKUP_INDEX_KEY`を
   使うが、HMAC計算前の入力に`"SUFFIX4:"`という固定タグを付与する
   (`app/core/crypto.py compute_suffix_lookup_hash`)。これにより、
   同一予約番号に対する完全一致索引の値と末尾索引の値が異なり、一方の
   索引値から他方を逆算する手がかりにならないようにしている(ドメイン
   分離)。
3. **4文字未満の予約番号には索引を作らない**。正規化後の文字列が4文字
   未満の場合、`compute_suffix_lookup_hash`はNoneを返し、
   `confirmation_number_suffix_lookup_hash`はNULLのままとなる。この
   ような短い予約番号を「末尾一致」で検索可能にすると、実質的に完全
   一致検索と同じ絞り込み精度になってしまうため。
4. **既存の`GET .../reservations/search`エンドポイントを拡張**。新規
   エンドポイントを作らず、既存の`confirmation_number`(完全一致)に
   加えて`confirmation_number_suffix`(末尾一致)を任意パラメータとして
   追加した。どちらか一方が必須(両方指定・どちらも未指定は400)。
   `confirmation_number_suffix`が4文字以外の場合も400とする(索引の
   粒度と一致しない検索は常に空振りになり、利用者に無意味な「該当なし」
   を返してしまうため、リクエスト時点でエラーとして知らせる)。

### 検証

サンドボックスで`alembic upgrade head`成功、alembic headが
`cc0e6eee0159`(down_revision=`5d57e3208d2a`)の単一headになることを
確認。

新規`tests/test_gate_r3_14_suffix_lookup_hash.py`(10ケース: 末尾4文字
一致検索、正規化(大文字小文字)一致、末尾指定4文字以外での400(3文字・
5文字)、完全一致パラメータとの同時指定400、両パラメータ未指定400、
4文字未満の予約番号での索引未作成(検索パラメータ自体が3文字のため
400になることを確認)、更新時のsuffix_lookup_hash更新、クリア時の
suffix_lookup_hash削除、APIレスポンスへの`confirmation_number_suffix_lookup_hash`
非露出、Gate R3-13の完全一致検索が引き続き動作することのリグレッション
確認)全てPASS。

### 次Gate候補

`reservation_participants`側の氏名検索、DOC-10監査の継続(FR-046画像/
PDF出力等)、旧平文列のcontract(削除)、Object Storage実連携。

---

## 改訂: Gate R3-15（2026-09-09）

Gate R3-13の次Gate候補で挙げていた「`reservation_participants`側の氏名
検索」を実装した。DOC-11 §6.3のblind indexパターンを、Gate R3-1で
追加した`reservation_participants.name`(Gate R3-8で暗号化列化済み)へ
適用する。

### 決定事項

1. **完全一致検索のみ**。Gate R3-13のconfirmation_numberと同じ方針とし、
   末尾検索や部分一致は対象外とする(氏名の末尾一致は「名字だけで検索」
   のような用途に本来向くが、そのような要件がDOC群に明記されていない
   ため、過剰実装を避けスコープを最小に留めた)。
2. **ドメイン分離**。`compute_participant_name_lookup_hash`は
   confirmation_number用の`compute_lookup_hash`と同じ`LOOKUP_INDEX_KEY`を
   使うが、入力に`"PARTICIPANT_NAME:"`タグを付与し、異なるフィールド間
   でHMAC値の相関が取れないようにする(Gate R3-14の末尾索引と同じ設計
   パターン)。
3. **plan横断検索**。予約個別ではなく`plan_id`配下の全予約の参加者を
   横断検索する。「この旅行の予約に田中さんが参加しているか」という
   利用シーンを想定し、個別予約IDを事前に知らなくても検索できるように
   した。`GET /{plan_id}/reservations/participants/search?name=...`
   というパスは、既存の`{reservation_id}/participants`(2 segments)や
   `{reservation_id}/participants/{participant_id}`(3 segments)と
   segment数が異なるため、定義順に関わらずルーティング衝突は起きない
   (Gate R3-13の`/reservations/search`のような定義順の配慮は不要)。
4. **他のblind indexと同じ運用ルールを踏襲**。LOOKUP_INDEX_KEY未設定時は
   検索のみ503、作成・更新は妨げない。APIレスポンスに
   `name_lookup_hash`は一切含めない。

### 検証

サンドボックスで`alembic upgrade head`成功、alembic headが
`725cce80af7c`(down_revision=`cc0e6eee0159`)の単一headになることを
確認。

新規`tests/test_gate_r3_15_participant_name_lookup_hash.py`(11ケース:
完全一致検索、正規化一致、未一致、name未指定400、同一plan内の複数予約
横断検索、plan間のスコープ分離、更新時のlookup_hash更新、APIレスポンス
への非露出、他ユーザー403、LOOKUP_INDEX_KEY未設定時503)全てPASS。

### migration適用中に見つけて修正した実装ミス

検索エンドポイント追加のためのstr_replace編集で、置換対象の`old_str`に
`@router.patch(`デコレータ行を含めていながら`new_str`側にその行を
書き戻し忘れ、直後の`update_participant`のデコレータが消失する
SyntaxError(`unmatched ')'`)を作り込んだ。サンドボックスでの
`pytest`実行(conftest.pyのimportエラーとして表面化)で発見し、
その場で修正した。パッチスクリプト生成・独立clone適用の前に
必ずサンドボックスでpytestを実行する運用が、このような単純な
編集ミスを本番投入前に確実に捕捉することを改めて確認した。

### 次Gate候補

DOC-10監査の継続(FR-046画像/PDF出力は「IDEA」評価が正確と確認済み。
他のFRの調査)、旧平文列のcontract(削除)、Object Storage実連携。
