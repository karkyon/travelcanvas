# ADR: 持ち物(FR-025)・準備タスク/レディネス(FR-026)の最小実装

- 状態: 採用(Gate P1)
- 前提HEAD: `2e062498a1a91756598093c43d04bc018e27962c`
- 関連: DOC-02 FR-025 / FR-026 / FC-068・FC-069・FC-070、DOC-05 §8.5、DOC-04 SC-21・SC-22
- トレーサビリティ: `docs/trace/gate-p1-trace.md`

## 1. 背景

FR-025(持ち物)・FR-026(準備タスク・レディネス)はDB・API・UIのいずれも存在しなかった(DOC-10 r6でSPECIFIED)。
出発前に「何が終わっていないか」を一覧できないと、予約・文書・制約を実装しても当日に漏れが残る。

## 2. 決定

### 2.1 テーブル(migration `a4d7e2c9b1f6`、additiveのみ)

| テーブル | 主な列 | 不変条件(DB CHECK) |
|---|---|---|
| `packing_items` | scope(shared/personal)、owner_user_id、assignee_user_id、name/note または payload_ciphertext、category、quantity、is_required、status、source、suggestion_key、revision、deleted_at | personalは暗号文のみ・平文列NULL・担当者なし / sharedは暗号文なし・名前あり / 数量1〜999 / 状態・分類・由来の列挙 / 候補由来ならsuggestion_key必須。採用済み候補は有効行の中で共有ならプランごと、個人なら本人ごとに一意(部分UNIQUE) |
| `preparation_tasks` | title、description、completion_criteria、due_at、status(open/done)、completed_at/by、assignee_user_id、related_type/related_id、readiness_key、revision、deleted_at | done ⇔ completed_atあり / 関連は種類とIDの両方か両方NULL / readiness_keyは有効行の中でプランごとに一意(部分UNIQUE) |

- `plan_id` は ON DELETE CASCADE(Gate B-012の外部キー削除方針の試験が検査する)。
- 担当者は `plan_members` テーブルが無いため users.id を持ち、表示時に「所有者+承諾済み共同編集者」
  に含まれるかを判定する。メンバーから外れた担当者は未割当として扱う(`assignee_missing`)。
  共同編集者の削除(B-013)に外部キーの扱いを追加しないで済む。
- タスクの関連先(予定・予約・区間・文書・持ち物)は外部キーにしない。予定などの個別削除(B-013)を妨げないため。
  表示時に存在を確認し、削除されていれば `related_missing` を返す。

### 2.2 個人の持ち物(FC-070「薬・健康用品は本人限定」)

- 名前とメモは `payload_ciphertext`(Fernet、`ENCRYPTION_KEY`)だけに保存する。未設定なら作成は503。
- 作成者本人以外(プラン所有者を含む)には一覧・件数・準備状況・候補判定のどれにも出さず、個別操作は404にする。
- 監査ログには名前・メモ・説明を記録しない(scope・由来・変更した項目名のみ)。

### 2.3 持ち物の候補(FC-069)

- `app/services/packing_suggestions.py`(`packing-rules-v1`)の決定的な規則で、日数・予定の種類と題名・予約・移動手段、
  画面で指定する条件(海外・洗濯・子ども連れ・常備薬)から理由付きの候補を作る。条件は保存しない。
- 天候は取得元が未接続のため判定せず、`unverified` に明記する(判定していない観点を「考慮済み」と誤解させない)。
- 採用済みの候補は外し、旅程の変更で理由が無くなった持ち物を `remove`、数量が変わった持ち物を `change` として返す。
  候補は提示だけで、持ち物は自動で変更しない(共通不変条件4)。

### 2.4 レディネス(FR-026)

- 保存しない読み取りモデル `app/services/readiness.py`(`readiness-v1`)。未予約(宿泊・移動の予定に予約なし)、
  未確認(予約が候補のまま)、未支払/支払状況未入力、取消期限72時間以内、期限切れタスク、未割当(タスク・必須の共有持ち物)、
  持ち物不足(必須が未準備/要購入)を検出する。予約は種類と事業者名だけを出し、予約番号などは使わない。
- 予約・支払系の項目は「タスクにする」ことで担当者・期限・完了条件を付けられる(`readiness_key`)。タスクを完了すると
  その項目は対応済みとして外れ、件数(`resolved_by_tasks`)に残る。予約不要の宿泊などを利用者の確認で閉じるため。
- 項目が0件の時だけ `is_ready=true`。画面は「未取得」「準備完了」「残りあり」を別に表示する。

### 2.5 権限

| 操作 | owner/editor | viewer |
|---|---|---|
| 一覧・候補・準備状況・メンバー | ○ | ○ |
| 共有の持ち物の作成・変更・削除 | ○ | ×(担当している持ち物の状態だけ変更可) |
| 個人の持ち物 | 本人のみ | 本人のみ |
| タスクの作成・変更・削除 | ○ | ×(担当しているタスクの完了/未完了だけ変更可) |

楽観ロックは持ち物・タスクごとのrevision(If-Match、428/409)。削除は論理削除。

## 3. 未対応(次のGate以降)

- 天候・活動の外部情報による候補、年齢区分の詳細、薬の時刻通知(FC-070)。
- 予算・費用(FR-027)と連動した「未払い」の金額集計。
- 通知(期限前のリマインド)、レディネスの履歴。
