# ADR: 予定・日程・経路候補・共同編集者の個別削除(紐付け解除して削除)

- 状態: 採用(Gate B-013、製品判断はユーザー承認済み 2026-09-27)
- 前提HEAD: `5b8cd6bf2bc9ecfe8f857e147a1baed15fcfe84e`(Gate B-012)
- 関連: FR-004・FR-005・FR-014・FR-015・FR-020・FR-021、FC-042、EX-010・EX-018、DOC-13(ロック)
- migration: なし(B-012 `e5b9c2d8f341` で横の参照は DEFERRABLE INITIALLY IMMEDIATE・即時検査のまま)
- トレーサビリティ: `docs/trace/gate-b013-trace.md`

## 1. 背景(B-013)

B-012はプラン全体の削除だけを直した。プラン内の個別削除は、横の参照(外部キー)の扱いが
決まっていないため、次の操作が外部キー違反で500になっていた(実DBで子データの種類ごとに再現)。

| 操作 | 失敗した外部キー |
|---|---|
| 予約が主紐付けされた予定を削除(予約が論理削除済みでも同じ) | `reservations.event_id` |
| 予約⇔予定の中間表で紐付いた予定を削除 | `event_reservations.event_id` |
| 経路候補の端点になっている予定を削除 | `route_options.from/to_event_id` |
| 上記いずれかの予定を含む日程を削除(移動区間の端点を含む) | 同上+`travel_segments.from/to_event_id` |
| 採用済みの経路候補を削除 | `travel_segments.route_option_id` |
| チケット担当者・参加者(論理削除済みを含む)になっている共同編集者を削除 | `tickets.holder_member_id` / `reservation_participants.plan_member_id` |

予定単体の削除で移動区間が端点になっている場合だけは、Gate M1が区間を同じChangeSetで削除していたため成功していた。

## 2. 決定

「409で拒否」ではなく「紐付け解除して削除」を採用する(利用者に事前の手動解除を強制しない)。

| 参照 | 扱い | 理由 |
|---|---|---|
| 予約(`reservations.event_id`)・予約⇔予定(`event_reservations`) | **紐付けだけ解除** | 予約は外部事業者との契約記録で独立している(DOC-13、FC-042「自動削除しない」) |
| 文書リンク(`document_links`、`entity_type='event'`。外部キー無し) | **リンクだけ解除** | 文書は原本で独立している。以前は予定を消すと参照先の無いリンクが残っていた |
| 予定を端点に持つ移動区間・経路候補(legs含む) | **一緒に削除** | 端点を失うと成立しない従属データ(端点XOR CHECKのためSET NULLは不可) |
| 採用元の経路候補を失う移動区間(`travel_segments.route_option_id`) | **参照だけ解除** | 区間は利用者が採用した予定の一部 |
| 予定の補助メモ(`event_links`、DBはCASCADE) | 一緒に削除(Undo用に記録) | 予定に従属 |
| チケット担当者・参加者(`holder_member_id`・`plan_member_id`) | **割当だけ解除** | EX-018「参加者が旅行から削除: 新規アクセス停止」。チケット・参加者の本体は残す |
| 予定・日程を対象にした制約(`constraints.scope_id`、外部キー無し) | 変更しない | 制約は利用者の意思。対象が消えると検証で「適用対象が削除されています」(L3)となり、Undoで元のIDに戻れば再び有効になる |

### 2.1 確定ロック(409)

`event_reservations.is_locked=true`(確定済み予定として誤操作から保護された紐付け)がある予定・日程の削除だけは、
**何も変更せずに**409で断る。応答は構造化する:

```json
{"detail": {"code": "locked_relation", "message": "…",
  "blocking": [{"type": "event_reservation", "id": "…", "event_id": "…", "reservation_id": "…", "reason": "locked"}]}}
```

ロック検査は変更の前に全件行う。移動区間の`status=confirmed`はロックとして扱わない(既存の予定削除で区間を消す挙動を変えない)。

### 2.2 1回のUndoで原子的に戻す

予定・日程・経路候補の削除は、本体・解除した関連・削除した従属データを**同じChangeSet**へ記録する
(FR-018「一つの変更セットとしてUndo可能」と同じ方式)。ChangeItemに予約・チケット本体は複製せず、
解除した関連のIDだけを残す。

| ChangeItem.entity_type | action | 保存する内容 |
|---|---|---|
| `reservation_event_ref` | unlink | 元の`event_id`、削除時点で予約が論理削除済みだったか |
| `event_reservation_link` | delete | 中間表の行(id・event_id・reservation_id・relation_type・is_locked)、予約の論理削除状態 |
| `document_link` | delete | リンクの行 |
| `segment_route_option_ref` | unlink | 元の`route_option_id` |
| `event_link` | delete | メモの行 |
| `travel_segment` / `route_option` | delete | 既存(Gate M1/M8)のスナップショット |

日程の削除は、以前は予定を**新しいID**で作り直していた(開始・終了時刻・place_idも失われていた)。
IDが変わると予約・制約・文書の参照先が失われるため、元のIDと全項目で戻すよう修正した
(idを持たない旧形式の記録は新しいIDで戻す)。

Undoの復元順序(外部キーは即時検査のため): 日程・予定 → 削除した経路候補 → 移動区間 → その他の経路候補・legs → 関連。
各段でflushし、全体をSAVEPOINT内で実行する。

### 2.3 Undo時の競合(上書きしない)

FR-020「削除競合を検出し黙って上書きしない」、EX-010に従い、Undoは**変更前に全件を検査**し、1件でも
安全に戻せなければ何も変更せず409にする(一部だけ戻った状態を残さない)。

| 状況 | reason |
|---|---|
| 予約・文書・移動区間が無い(別プラン含む) | `not_found` |
| 削除後に予約・文書が論理削除された | `deleted` |
| 予約が別の予定へ紐付け直された、同じ紐付け・リンクが既にある | `relinked` |
| 同じ日付の日程が作られた(以前は一意制約違反で500) | `date_taken` |
| 検査後の予期しない制約違反 | `restore_failed`(SAVEPOINTごと巻き戻す) |

応答は `{"detail": {"code": "undo_conflict", "message": "…", "conflicts": [{"type", "id", "reason"}]}}`。
同じ予約の主紐付けと中間表の紐付けが同じ理由で重なる場合は1件にまとめる。

### 2.4 共同編集者の削除(アクセス取消し)

所有者のみ。常に成功させ、チケット担当者・参加者の割当だけを外す(他の共同編集者・予約・チケット・旅程は変更しない)。
ChangeSetの対象外のためUndoは無く、再招待で戻す。監査(`collaborator_removed`)には件数だけを残し、メールアドレスは残さない。

### 2.5 応答と画面

- 削除応答に `detached`(外した予約・文書リンクの件数、一緒に削除した区間・経路候補の件数、参照を外した区間の件数)を追加。
- 画面は件数から「予約1件との紐付けを外しました(予約の内容は残っています)。移動区間1件も削除しました。「元に戻す」でまとめて復元できます。」のように案内する。
- 確定ロック・Undo競合の409は、版の競合とは別の文言で理由と対処を示す(ロックの場合は再読み込みしない)。
- 予定削除の画面は、失敗しても「スケジュールを削除しました」と表示していた。成功した時だけ表示するよう修正。

## 3. 同時に解消したもの(B-014: 移動区間・経路候補画面のIf-Match)

backendの移動区間の更新・削除、経路候補の採用・削除は If-Match を**プランの版番号**と照合するが、
画面は**項目ごとのrevision**を送っていたため、画面からの操作がほぼ常に409で失敗していた
(B-011のCORS修正後も、これらの画面操作のbrowser E2Eが無く未発見だった)。画面はプラン詳細の版番号を送るよう修正し、
E2Eで採用・削除を確認した。

## 4. 検討して採らなかった案

| 案 | 採らなかった理由 |
|---|---|
| 関連があれば常に409で拒否 | 利用者に事前の手動解除を強制し削除UXが悪い。共同編集者のアクセス取消しが関連で妨げられる |
| 外部キーを ON DELETE SET NULL に変更 | 区間・経路候補の端点XOR CHECKを壊す。Undoで何を戻すべきかの記録が残らない。migrationが必要 |
| 予約・チケットもCASCADEで削除 | 独立した業務記録を予定の削除で失う(FC-042) |
| ChangeItemに予約本体を複製して保存 | 暗号化列・盲検索索引を含む秘匿情報の複製になる。Undoで他の変更を上書きする危険 |

## 5. 再発防止

`tests/test_gate_b013_item_deletion.py::test_every_foreign_key_into_individually_deletable_tables_has_a_policy` が、
実DBの外部キー一覧(`travel_events`・`travel_days`・`route_options`・`plan_collaborators`を参照するもの)と
`app/services/plan_item_deletion.py` の `*_REFERENCE_POLICY` を突き合わせる。参照を追加して扱いを決め忘れると失敗する。

## 6. 未対応・制約

- EX-018の「個人データ返却・削除」(削除された参加者の秘匿制約等の扱い)は未対応。アクセス停止と割当解除のみ。
- 経路候補のlegs(`route_legs`)単体の削除、予約・文書・チケット・参加者の削除は従来どおり論理削除またはUndoの無い操作。
- 移動区間・経路候補の`revision`は、Undoでの再作成時に1へ戻る(既存のGate M1/M8と同じ)。
