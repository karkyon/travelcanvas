# ADR: 文書ウォレット(FR-013) 最小実装（Gate R3-6）

- 状態: ACCEPTED
- 日付: 2026-09-09
- 対象: Gate R3-6（`documents`/`document_links`最小CRUD）
- 正本: DOC-02 FR-013, DOC-05 §6.5/§6.6, DOC-06 §9, DOC-08 §4.3, DOC-11 §2/§6/§7
- 調査基準HEAD: `a23f9a46298eb51b3d6a73f0837705b2f0c3f3f3`

## 背景

DOC-10のFR-013静的評価は「IDEA/SPECIFIED」であり、実体は一切存在しな
かった(独立clone調査で確認)。DOC-05 §6.5/§6.6が定義するdocuments/
document_linksのフル仕様は以下を要求する。

- Object Storage(DOC-08 §4.3: private bucket、versioning、lifecycle、
  malware scan、短命署名URL、KMS暗号化)との連携
- アップロードセッション発行API(DOC-06 §9 `POST /plans/{id}/documents
  /uploads`)による署名URL方式のアップロード
- malwareスキャンprovider連携(RB-007 Runbookが前提とする検体隔離)
- OCR provider連携(FR-011予約取込の前提条件でもある)
- KMS envelope encryption(DOC-11 §6.3)

本コードベースにはObject Storage・malwareスキャナ・OCR provider・KMS
のいずれも導入されていない。これらを一度に実装するのは大規模スコープ
であり、Gate R3-0(予約管理)と同じ理由により、狭くとも縦切りで完結さ
せる方が安全と判断した。

## 決定事項

### 1. スコープをメタデータCRUDに限定し、実ファイルは一切扱わない

DOC-05 §20「大容量原本はDBへ格納せずObject keyとhashだけ保持」の方針
に従い、本Gateでは`storage_key`(呼び出し側が別途アップロード済みの
オブジェクトキー)をそのまま受け取ってメタデータのみを永続化する。

- 実装するのは以下のみ: `documents`テーブル、`document_links`テーブル、
  `POST/GET/PATCH/DELETE /api/v1/plans/{plan_id}/documents[/{id}]`、
  `POST/GET/DELETE .../documents/{id}/links[/{link_id}]`
- DOC-06 §9の署名URL発行エンドポイント(`POST /plans/{id}/documents
  /uploads`)はObject Storage未導入のため実装しない。将来Object
  Storageを導入する際に本Gateの`storage_key`直接指定方式を置き換える。

次Gate以降のスコープ(本Gateでは着手しない): Object Storage実連携、
署名URLアップロードセッション、malwareスキャン、OCR、KMS envelope
encryptionへの移行、`tickets.display_document_id`へのFK制約追加。

### 2. malware_status/ocr_statusはクライアント入力を拒否し常に既定値とする

スキャナ・OCR providerが存在しないため、`malware_status`は常に
`not_scanned`、`ocr_status`は常に`not_requested`で作成する
(`DocumentCreateRequest`にこれらのフィールドを含めず、クライアントが
偽装した安全表示(`clean`等)を作れないようにする)。将来のバッチジョブが
これらの状態を更新する想定の設計とする(additive)。

### 3. original_filenameはGate R2-2/R3-0と同じFernet field encryptionで保護する

DOC-11の本来の要求はKMS envelope encryptionだが、KMS未導入のため
`app/core/crypto.py`の`ENCRYPTION_KEY`ベースFernet暗号化を再利用する
(QuickDraft/Reservation/Ticketと同じスコープ限定)。`encryption_key_ref`
列はKMS参照用にDOC-05通り定義するが、KMS未導入のため常にNULLとする。

DOC-11 §2のデータ分類表でoriginal_filenameは「権限」表示に分類されて
おり(confirmation_number/pin/ticket payloadのような「reveal」表示では
ない)、本Gateでは通常のGET応答で復号済みfilenameをそのまま返す
(viewer以上の閲覧権限があれば表示、明示revealエンドポイントは設けない)。

### 4. document_linksはentity_typeごとに存在検証する(IDOR対策)

`entity_type`が`reservation`/`event`/`ticket`の場合、対象が同一plan
内に存在することをAPI側で検証する(他planのリソースへ誤ってリンクで
きないようにする。Gate R3-3の`event_reservations`と同じパターン)。
`attachment`(汎用種別)は検証しない。`entity_id`はポリモーフィック
参照のためDB外部キー制約を持たない。

### 5. 権限モデルはGate #30の`plan_access.py`をそのまま利用する

- 作成/更新/削除: `min_role="editor"`
- 閲覧(一覧・詳細・リンク一覧): `min_role="viewer"`
- classificationによる追加のアクセス制限(例: RESTRICTED文書をviewer
  から隠す)は本Gateでは実装しない。次Gate候補とする。

### 6. 楽観ロックは既存If-Matchパターンを踏襲する

`Document.revision`を対象とした`If-Match`ヘッダー必須方式とする
(`app/api/v1/reservations.py`と同一設計。作成はIf-Match不要、更新・
削除は必須)。

## 検証

- サンドボックス(PostgreSQL 16 + venv)で`alembic upgrade head`が成功
  し、alembic headが`c9a1e73d8f42`(down_revision=`b48d9f2c6e17`)の
  単一headになることを確認した。
- 新規`tests/test_gate_r3_6_documents.py`(9ケース: filename暗号化、
  malware_status/ocr_status上書き拒否、一覧・詳細、If-Match必須/
  409/成功、soft delete、document_links作成・一覧、他plan所属
  リソースへのリンク404、リンク削除、他ユーザー403)が全てPASS。
- 既存backendテストスイート全体(213件、Gate R3-6追加分含む)がPASS。
  リグレッションなし。

## 次にやるべきこと(次Gate候補)

1. Object Storage実連携(署名URLアップロードセッション、DOC-06 §9)
2. malwareスキャンprovider連携(RB-007 Runbook対応)
3. OCR provider連携(FR-011予約取込の前提)
4. `tickets.display_document_id`へのFK制約追加(本Gate完了により
   `documents`テーブルが存在するため技術的には可能)
5. classification(RESTRICTED等)に応じたviewerからの閲覧制限
6. frontend UI(文書一覧・アップロードフォーム・リンク表示)
