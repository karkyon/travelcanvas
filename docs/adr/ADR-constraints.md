# ADR: 制約(FR-016)の最小実装

- 状態: 採用(Gate L2)
- 前提HEAD: `5b73cfeb16e8a09876a50115d6c838ca37deb82f`
- 関連: DOC-02 FR-016 / FR-023、DOC-05 §7.3・§17・§19、DOC-06 §10・§21、DOC-04 SC-15
- トレーサビリティ: `docs/trace/gate-l2-fr016-trace.md`

## 1. 背景

FR-016(制約管理)はDB・API・UIのいずれも存在しなかった。実行可能性検証(FR-017)と
説明可能な最適化(FR-018)は制約を入力とするため、先に制約のドメインを置く。

## 2. 決定

### 2.1 テーブル

`constraints`(model名 `PlanConstraint`)を新設する(migration `b7d41e9c2a53`、additiveのみ)。
列はDOC-05 §7.3に従うが、次を変更する。

| DOC-05 | 本実装 | 理由 |
|---|---|---|
| owner_member_id | owner_user_id(必須) | plan_membersテーブルが存在しない(所有者はtravel_plans.user_id、共同編集者はplan_collaborators)。作成者=本人を常に持つため「privateならowner必須」は自動的に満たされる |
| type | constraint_type | Pythonの組込名と衝突しないため |
| value_ciphertext/json | shared: title+value_json、private: value_ciphertextのみ | privateは題名も秘匿対象(題名だけで内容が分かるため) |
| — | is_active、deleted_at | 一時的に外す操作と論理削除 |

DBのCHECK制約で不変条件を守る: hardならweightはNULL、softなら1〜100 / scope_type='plan'ならscope_idはNULL /
privateなら暗号文あり・平文列(title/value_json)はNULL、sharedなら暗号文なし・titleあり / 有効期間の前後関係。
`value_json` は `JSON(none_as_null=True)` とする(既定のJSON型はPythonの`None`をJSONの`null`値として書き、
privateのCHECKに違反する。統合試験で検出した)。

### 2.2 秘匿(private)と理由

- private制約の題名・種類・演算子・値・重み・対象・有効期間は作成者本人にだけ返す。他のメンバー
  (**プラン所有者を含む**)には `visibility="masked"` として、存在・hard/soft・適用範囲の種類・有効かだけを返す
  (FR-016「詳細非表示のまま判定へ使う」、FR-023、DOC-06 §21「Constraint private: 本人」)。
- reasonはshared/privateに関係なく常に暗号化し、作成者本人にだけ返す(DOC-05 §19: R、本人のみ)。
- 監査ログには題名・値・理由を記録しない(plan_id・hardness・privacy_levelのみ)。
- 暗号化はR3系と同じFernet(`ENCRYPTION_KEY`)。未設定なら秘匿制約・理由付きの作成は503。

### 2.3 権限

| 操作 | shared | private |
|---|---|---|
| 一覧・取得 | viewer以上 | viewer以上(他人の分はmasked) |
| 作成 | editor以上 | viewer以上(自分の制約として) |
| 変更・削除 | editor以上 | 作成者本人のみ(所有者も不可) |
| 共有/秘匿の切替 | 作成者本人のみ(sharedへの切替はeditor以上) | 同左 |

### 2.4 楽観ロック・削除

- 制約ごとのrevision＋If-Match(予約R3系と同じ方式)。未指定428、不一致409。
- 削除は論理削除。プランのChangeSet(Undo)には記録しない。制約は旅程そのもの(Day/Event)ではなく
  旅程に対する条件であり、プランrevisionを進めると旅程編集中の他メンバーに不要な409を起こすため。
  制約変更のUndoは将来の検討事項とする。

### 2.5 適用範囲

- plan / day / event / member。day/eventは削除され得るため外部キーにせず、書込時にプラン所属を検証し、
  読出時に存在しなければ `scope_missing=true` を返す。memberはプランの所有者または承諾済み共同編集者に限る
  (省略時は本人)。他プランの対象は「見つからない」と同じ422。
- プランから外れたメンバーのprivate制約は一覧・判定から除外する(本人以外は変更も削除もできず、
  判定に残すと理由の分からない制約になるため)。shared制約はプランのデータとして残す。
- `plan_id` は `ON DELETE CASCADE`(プラン削除を制約が妨げない)。

### 2.6 判定用の読み出し

`app/services/constraint_evaluation.py` の `load_constraints_for_evaluation(db, plan, at=None)` が、
有効な制約をprivateも復号して返す(Gate L3の実行可能性検証・最適化が使う)。理由は復号しない。
復号できないprivate制約は捨てずに `unavailable` へ入れる(FR-017「検証不能を問題なしにしない」)。
**この戻り値をAPI応答へ直接出してはならない。**

### 2.7 CORS(同Gateで修正)

`allow_methods` にPATCHが無く、別オリジンのfrontendからのPATCHはプリフライトで拒否されていた
(区間・経路候補・経路区間・予約×イベント紐付けの編集が画面から一度も成功していなかった)。
制約の編集のbrowser E2Eで発覚したため、PATCHを追加し、全ルートのメソッドがCORSで許可されていることを
`tests/test_gate_l2_cors_methods.py` で検査する。

## 3. スコープ外

- 制約に照らした旅程の検証(FR-017) → Gate L3で実装(`ADR-feasibility-validation.md`)。最適化への反映(FR-018)。
- 制約変更のUndo、制約の複製(旅程複製FR-047では複製しない)、有効期間のUI入力(APIのみ)。
- 秘匿制約を持つメンバーが離脱した後のデータ削除(DOC-05 §22「deleted memberのprivate data」)。

## 4. 既知の別問題(本Gateでは修正しない)

日程・イベント・予約のいずれかを持つプランを `DELETE /travel-plans/{id}` で削除すると500になる
(子テーブルの外部キーに削除時の扱いが無い)。FR-004の論理削除設計と合わせて別Gateで扱う。
→ Gate B-012で解消(`docs/adr/ADR-plan-deletion.md`。論理削除→猶予期間→完全削除)。
