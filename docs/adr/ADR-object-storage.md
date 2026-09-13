# ADR: Object Storage実連携(FR-013 文書ウォレット) — Gate M5

- 対象: `karkyon/travelcanvas`
- Gate: M5(FR-013 Object Storage実連携)
- 前提HEAD: `b1b7448d6b7505f32ae63783333c91f43028ce80`(Gate M3完了時点)
- 基準資料: DOC-02(FR-013)、DOC-05 §6.5(documents)、DOC-11(セキュリティ)

## 背景

Gate R3-6で`documents`/`document_links`のメタデータCRUDのみを実装して
いたが、実ファイルのアップロード・保存・ダウンロードは一切存在せず、
`storage_key`は呼び出し側(クライアント)が自分で用意した文字列を
そのまま受け取るだけだった。DOC-02 FR-013は「ファイルウイルス検査、
MIME検証、容量制限、暗号化、期限付きURLを適用する」ことを要求している。

## 決定事項

### 1. 実クラウドストレージのAPIキーは未提供

`route_estimator.py`がGoogle Directions APIキー未提供でhaversine概算に
留めたのと同じ制約により、AWS S3等の実クラウドストレージ連携には認証
情報が必要だが提供されていない。本Gateでは`StorageBackend`抽象
インターフェースを設け、既定実装として`LocalFilesystemBackend`
(dockerボリューム上のローカルディスク)を追加した。将来実クラウド
providerの認証情報が提供された場合、同インターフェースを実装する
アダプタへ設定一つで差し替えられる設計とした。

### 2. 実アップロードエンドポイントを新設(既存メタデータ登録は維持)

既存の`POST /plans/{plan_id}/documents`(storage_key等をクライアントが
指定するメタデータのみ登録用)は後方互換のため変更せず維持した。新規に
`POST /plans/{plan_id}/documents/upload`(multipart/form-data)を追加し、
`storage_key`/`mime_type`/`size`/`sha256`を**すべて実ファイル内容から
算出**する(クライアント入力を信頼しない設計)。

### 3. MIME検証(python-magic等の追加依存なし)

新規の外部依存ライブラリを追加せず、既存の`ALLOWED_DOCUMENT_EXTENSIONS`/
`ALLOWED_IMAGE_EXTENSIONS`(app/utils/validators.py)を拡張子allowlistとして
再利用した。加えて、宣言された拡張子と実際のファイル内容の先頭バイト列
(マジックナンバー: PDF `%PDF-`、JPEG `\xff\xd8\xff`、PNG `\x89PNG...`等)
が一致することを検証し、単純な拡張子偽装を防ぐ。doc/docx等のコンテナ
形式(zip)やtxt/mdはマジックナンバー検証の対象外とした(誤検知で正当な
文書を拒否しないため)。

**ウイルススキャン自体は本Gateのスコープ外**とする。外部AVエンジン
(ClamAV等)が未導入であり、マジックナンバー検証はその代替にはならない
(あくまで拡張子偽装対策)。`Document.malware_status`は引き続き
`not_scanned`のまま作成される(捏造しない)。

### 4. 容量制限

`DOCUMENT_MAX_UPLOAD_SIZE_BYTES`(既定20MB)を新規設定として追加し、
超過時は413を返す。

### 5. 保存時暗号化(既存ENCRYPTION_KEYを再利用)

ファイル内容自体を、既存のFernet field encryption
(app/core/crypto.py、ENCRYPTION_KEY)で暗号化してからディスクへ書き込む。
`Document.encryption_key_ref`列は、KMSによるper-file envelope encryption
鍵への参照用に予約されている別概念であり、KMS未導入の本Gateでは引き続き
NULLのままとする(DOC-05 §6.5)。ENCRYPTION_KEY未設定時はアップロード・
ダウンロード双方とも503を返す(他の暗号化依存機能と同じ運用ルール)。

### 6. 期限付きダウンロードURL

新規設定`DOCUMENT_DOWNLOAD_SIGNING_KEY`(ENCRYPTION_KEY/LOOKUP_INDEX_KEY
と同じ理由で別鍵とする用途分離)を用い、`document_id + 有効期限
(既定15分、DOCUMENT_DOWNLOAD_URL_TTL_SECONDS)`をHMAC-SHA256署名した
トークンを発行する(S3署名付きURLと同じ設計思想)。

- `GET /plans/{plan_id}/documents/{document_id}/download-url`
  (通常のplan ACL確認、viewer以上)がトークンを発行する。
- `GET /plans/documents/download?token=...`
  (トークン検証のみ、plan ACLは再確認しない)が実際にファイルを
  ストリーミング返却する。トークン自体が発行時点のACL確認済みの
  証跡であり、TTLと署名のみで安全性を担保する。
- 署名不一致・期限切れは403、DOCUMENT_DOWNLOAD_SIGNING_KEY未設定時は
  発行・ダウンロード双方とも503とする。

### 7. path traversal対策

`storage_key`はAPI側(`generate_storage_key`)が`{plan_id}/{uuid}{ext}`
の形式で常に生成し、クライアントからは受け取らない(実アップロード
エンドポイント経由の場合)。`LocalFilesystemBackend`側でも防御的に
resolve後のパスがbase_dir配下であることを検証する。

## 実装中に発見して修正した不具合

`documents.py`へ新規エンドポイントを追記するstr_replace編集で、
既存の`list_documents`関数の直上にあった`@router.get("/{plan_id}/documents",
response_model=List[DocumentResponse])`デコレータ行を誤って消してしまい、
`GET /plans/{plan_id}/documents`(一覧取得)ルートが登録されなくなる
不具合を作り込んだ(Gate M1のPlannerPage.py編集時、Gate R3-15のupdate_participant
編集時と同種のミス)。既存の`test_gate_r3_6_documents.py`回帰テストの
実行で即座に検出し(405 Method Not Allowedとして表面化)、その場で
修正した。

## 検証

- migration不要(既存の`storage_key`/`mime_type`/`size`/`sha256`列は
  Gate R3-6で既に存在しており、schema変更なし)。
- 既存`tests/test_gate_r3_6_documents.py`(9ケース)全てPASS(リグレッション
  なし、上記不具合の修正込み)。
- 新規`tests/test_gate_m5_object_storage.py`(11ケース: 実メタデータ算出、
  容量制限超過413、拡張子拒否422、拡張子/内容不一致422、editor以上必須、
  保存時暗号化(ディスク上の内容が平文と一致しないこと・復号後に一致
  すること)、ダウンロードURLの往復roundtrip、改竄トークン拒否、
  期限切れトークン拒否、viewer以上必須、signing key未設定503)全てPASS。
- backend全体338件(既存327件+新規11件)全てPASS。
- `python -m compileall app`: エラー0。

## 残件(次Gate)

- 実クラウドStorage provider(S3等)への切り替え(認証情報提供後)。
- ウイルススキャン(外部AVエンジン統合)。
- OCR連携(`ocr_status`は引き続き`not_requested`固定)。
- frontend側の実アップロードUI(現状のDocumentsPage.tsxはメタデータ
  登録のみ、ブラウザSubtleCryptoでのSHA-256計算に留まる。実アップロード
  フローへの更新は次Gate)。

## 改訂: Gate M6(frontend接続)

Gate M5のbackend契約(実アップロード・期限付きダウンロードURL)を、
実際の画面から使えるようにした。

### 実施内容

- `frontend/src/services/api.ts`: `uploadDocument`(multipart/form-data
  でのPOST)、`getDocumentDownloadUrl`、および両者のオリジンを解決する
  `resolveDownloadUrl`ヘルパーを追加。
- `frontend/src/pages/DocumentsPage.tsx`: 旧来の
  `createDocument`+`"local-pending/..."`プレースホルダー
  +ブラウザSubtleCryptoでのSHA-256計算(Gate R3-10)を廃止し、
  `uploadDocument`(実ファイルアップロード)へ全面的に切り替えた。
  一覧の各文書にダウンロードボタンを追加し、`getDocumentDownloadUrl`で
  発行した期限付きURLを新規タブで開く。

### 検証

- `npm install`後、変更前のbaseline(vitest 73件PASS、`tsc --noEmit`
  エラー0)を確認してから着手した。
- `frontend/src/services/api.test.ts`にアップロード/ダウンロードURL
  APIクライアントの単体テスト3件を追加。
- 変更後: `tsc --noEmit`エラー0、`vitest run` 76件PASS(73+3、
  リグレッションなし)、`vite build`成功を確認。
- backend側は無変更のため338件PASSを再確認するに留めた。
