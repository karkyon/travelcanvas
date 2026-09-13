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

## 改訂: Gate M7(文書ウォレット安全化、2026-09-13監査対応)

2026-09-13総合再監査(P0-01〜P0-04、P1-01、P1-02)を受け、以下の是正を
行った。対象範囲外の項目(RESTRICTED以外のclassification別policy細分化、
document単位のgrant domain新設、AV/OCR/KMS/クラウドStorage連携)は
引き続き対象外とし、次Gate候補に残す。

### 1. 旧metadata登録APIの閉鎖(P0-01)

`POST /{plan_id}/documents`(クライアントが`storage_key`を自由に指定
できた、Gate R3-6由来の初期実装)は、Gate M5でサーバー生成型upload API
(`POST .../documents/upload`)へ信頼境界を移行した後も後方互換の名目で
公開されたままであり、他文書のstorage_keyを指定した偽装metadata作成を
許していた。本Gateで通常利用を410 Goneとして閉鎖した。

**既存metadata-only文書行への方針**: 本Gate以前に旧APIで作成された
document行(実ファイル実体を伴わない可能性がある行)についても、
migrationでの実体捏造やデータ改変は一切行わない。当該行は従来通り
metadataのみの状態のまま存在し続け、download-url/downloadエンドポイントが
`FileNotFoundError`を404として素直に返す(既存の挙動を変更しない)。
将来的にこれらの行を一括で識別・除去する必要が生じた場合は、別Gateとして
明示的なmigration/バッチ処理を設計する。

### 2. `storage_key`の非公開化(P0-02)

通常の`DocumentResponse`(list/get/update/upload)から`storage_key`を
除外した。DB上の列は変更しない(内部処理では引き続き使用する)。
ダウンロードは署名付きURL(`download-url`→`download?token=...`)経由で
完結するため、利用者へ内部参照を返す必要はない。

### 3. RESTRICTED文書のowner-only既定化(P0-03)

document単位の明示的なgrant domain(誰が閲覧可能かを個別に登録する仕組み)
は現行コードベースに存在しない。これを今回新設して曖昧な権限を発明する
のではなく、安全側の既定値として「classification="restricted"の文書は
document owner本人(`owner_user_id`)にのみ可視」というルールを採用した。
plan owner自身であっても、当該RESTRICTED文書のowner本人でなければ
同様に404となる(planロールによる特権を発明しない)。

一覧・詳細・download-url発行・document_links(作成/一覧)の全経路に
同一のポリシーを適用し、非ownerには文書の存在・件数・ファイル名を一切
返さない(「見つからない」404で統一し、権限不足と存在しないIDを区別
できないようにする)。公開共有リンク(`public_share.py`)はそもそも
Documentへ一切触れないホワイトリスト方式であるため、RESTRICTED文書を
含めいかなる文書情報も公開ビューへ現れないことを契約テストで固定した。

### 4. storage file purgeの再試行可能な実装(P0-04)

`DELETE /{plan_id}/documents/{id}`は、soft delete(`deleted_at`)を確定
させた直後に実storage fileの削除を即時試行するよう変更した。即時試行が
失敗しても(ストレージ障害等)ユーザー操作自体は失敗させず、新設した
`documents.purge_status`列(pending/purged/failed。additive migration
`7f2a4c9e1b36`)に結果を記録する。

再試行可能なバッチ処理として`app/services/document_purge_service.py`
(`purge_deleted_documents`: 未purgeの削除済み行を再試行、ファイル不在は
idempotentに成功扱い / `soft_delete_expired_retention_documents`:
`retention_until`超過分をsoft delete対象へ遷移)と、そのCLIラッパー
`scripts/run_document_purge.py`(既存`scripts/run_quickdraft_purge.py`と
同じ運用パターン)を新設した。cron等のスケジューラ導入自体は本Gateの
スコープ外とし、実行可能なスクリプトの提供に留める(運用担当が
`docker compose exec backend python scripts/run_document_purge.py`を
定期実行することを想定)。

### 5. Content-Disposition安全化(P1-01)

復号済みfilenameをそのままheaderへ組み込んでいたため、CR/LFによる
header injectionの原理的リスクがあった。RFC 6266/5987相当の形式
(ASCII fallback + `filename*=UTF-8''...`のパーセントエンコード)で
組み立てるよう変更し、header injection試験を追加した。

### 6. ダウンロード監査ログ(P1-02)

ダウンロード成功・失敗(無効token/期限切れ/ファイル不在)いずれも
`audit_logs`へ記録するよう変更した。token文字列・storage_key・
復号後filenameは`details`へ一切含めない(`resource_id`にdocument_idの
みを記録し、必要なら別途documentテーブルと突き合わせて調査できる形に
留める)。署名付きtoken自体の即時失効・key rotation/versionは引き続き
未実装であり、次Gate候補とする。

### 検証

- サンドボックス(PostgreSQL 16 + venv)で`alembic upgrade head`
  (新規head `7f2a4c9e1b36`)のupgrade→downgrade→再upgradeサイクルが
  成功、単一headを確認。
- `python -m compileall app scripts alembic tests`: エラー0。
- FastAPIアプリの起動確認、documents関連全11 routeの登録(デコレータ
  消失なし)を確認。
- 既存`tests/test_gate_r3_6_documents.py`(旧API前提だった箇所をupload
  経由へ更新、410 Goneの新規ケース含め10ケース)、
  `tests/test_gate_m5_object_storage.py`(storage_key非公開に伴い2ケース
  更新)、新規`tests/test_gate_m7_document_hardening.py`(9ケース:
  RESTRICTED非owner非表示/owner可視/links非表示、共有経路非露出契約、
  即時purge成功、purge失敗からの再試行成功とidempotent再実行、retention
  超過のsoft delete遷移、Content-Dispositionのheader injection耐性、
  ダウンロード監査ログの機微値非含有)を含め、backend全体348件
  (既存338件+新規10件)全てPASS。リグレッションなし。
- frontend: `tsc --noEmit`エラー0、`vitest run` 76件PASS(既存76件、
  storage_key/createDocument削除に伴うリグレッションなし)、
  `vite build`成功。
- `scripts/security/scan_secrets.py`: tracked secret 0。

### 残件(次Gate候補)

1. Gate M8 RouteOption/RouteLeg/adopt完全Undo(P1-03)
2. Gate M9 lint debt解消とCI blocking化(P1-04)
3. Gate M10 中核機能Playwright E2E拡張(document upload/download/
   restricted拒否/deleteを含む。P1-05)
4. classification細分化のpolicy(チケット閲覧/費用閲覧等)、document単位の
   明示的grant domain
5. 署名付きtoken自体の即時失効・key rotation/version
6. frontend bundle縮小(P1-06、`api.ts`のdomain別分割・route lazy load)
