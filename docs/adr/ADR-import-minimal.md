# ADR: 予約取込(FR-011) 最小実装（Gate R3-7）

- 状態: ACCEPTED
- 日付: 2026-09-09
- 対象: Gate R3-7（`import_jobs`/`extraction_candidates`最小実装）
- 正本: DOC-02 FR-011, DOC-05 §6.7/§18.2, DOC-08 §3, DOC-11 §4.3
- 調査基準HEAD: `e3f3c9cfd79db64cf225f5ca40264ede19c2dd83`

## 背景

DOC-10のFR-011静的評価は「IDEA/SPECIFIED」であり、実体は一切存在しな
かった。DOC-05 §18.2が定義するジョブ状態遷移は
`uploaded -> scanning -> extracting -> review_required -> confirmed/
rejected`であり、これはAI/OCR providerによる自動抽出パイプラインの
存在を前提としている。本コードベースにはAI/OCR providerが一切導入
されていない(DOC-08 §3 Image/OCR行はPillow/OpenCV + provider adapter
を候補としているのみで未実装)。

## 決定事項

### 1. scanning/extractingへの自動遷移を実装しない

ジョブは作成時点で直接`review_required`となる。実際のOCR/AI抽出が
存在しないため、`extraction_candidates`は利用者自身が(実質的に手動
転記として)登録する運用とする。DOC-02「AIは提案と抽出を行うが…重要
変更を無確認で実行しない」のうち「人間レビュー必須」という制約は本
Gateでも厳格に維持する(AIによる自動候補生成が無いだけであり、
「確定前にドメインへ反映しない」という制約自体は変えない)。

`quarantined`(malware検知)/`retry_wait`(provider障害)は対応する
providerが存在しないため、状態のenum定義のみ残し、本Gateでは到達しない。

### 2. confirmエンドポイントでのみReservationへ反映する

DOC-05 §6.7「確定前に本テーブルからドメインへ反映しない」を、
`POST /imports/{job_id}/confirm`内でのみ`Reservation`を生成すること
で実装上保証する。`review_status="accepted"`の候補のみを対象とし、
`type`フィールドのaccepted候補が無い場合は422で拒否する(Reservation
の必須フィールドのため)。confirm後はジョブが`review_required`状態を
離れるため、候補追加・再confirmは409で拒否される(不変条件)。

candidate側のfield_pathは、`app/api/v1/reservations.py`の
`ReservationCreateRequest`と同じフィールド集合に限定する(想定外の
フィールドへの書き込みを防止)。日時・数値型フィールドは文字列から
変換し、失敗時は422を返す。

### 3. candidate_valueはGate R2-2/R3-0と同じFernet field encryptionで保護する

confirmation_number等の機微情報を含みうるため、`candidate_value_
ciphertext`として暗号化保存する。一覧・詳細レスポンスでは復号済みの
値をそのまま返す(reservation本体と異なりreveal操作を設けない。理由:
これは確定前の下書きデータであり、レビューする利用者が内容を見えな
ければ採否を判断できないため。ただし実際のドメインデータ化はconfirm
操作のみが行い、owner/editor限定かつ監査ログ必須とすることで制御を
維持する)。

### 4. documentとの紐付けは任意(nullable)とする

`import_jobs.document_id`はGate R3-6の`documents`テーブルへの任意の
参照とする(nullable)。文書を経由しない取込(例: 利用者がメール本文を
見ながら手動で候補を入力するケース)も許容するため。指定する場合は
同一plan内のdocumentであることを検証する(404)。

### 5. 権限モデルはGate #30の`plan_access.py`をそのまま利用する

- ジョブ作成/候補登録・レビュー/confirm/reject: `min_role="editor"`
- 閲覧(一覧・詳細): `min_role="viewer"`

## 検証

- サンドボックス(PostgreSQL 16 + venv)で`alembic upgrade head`が成功
  し、alembic headが`d3e5f9a1b264`(down_revision=`c9a1e73d8f42`)の
  単一headになることを確認した。
- 新規`tests/test_gate_r3_7_imports.py`(8ケース: consent無しでの
  作成拒否422、review_required状態での作成、候補の暗号化保存、
  不正field_path拒否422、候補0件でのconfirm拒否422、accept/reject
  を経たconfirmでのReservation生成(reject候補は非反映)+監査ログ
  確認+confirm後の409、reject操作、他ユーザー403)が全てPASS。
- 既存backendテストスイート全体(221件、Gate R3-7追加分含む)がPASS。
  リグレッションなし。

## 次にやるべきこと(次Gate候補)

1. AI/OCR provider連携(実際のscanning/extracting自動遷移の実装)
2. `reservation_participants`/`holder_name`/`contact_phone`の暗号化列化
3. `lookup_hash`による盲検索index(DOC-11 §6.3)
4. frontend UI(取込ジョブ一覧・候補レビュー画面)
5. メール取込連携(MailProvider抽象化、DOC-03 外部連携抽象化)
