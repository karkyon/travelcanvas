# ADR: 実行可能性検証(FR-017)の最小実装

- 状態: 採用(Gate L3)
- 前提HEAD: `18665181c062bebaa924c0c4def1bb42e1a8c55a`
- 関連: DOC-02 FR-017 / FR-016 / FR-023、DOC-05 §7.3、DOC-06 §9、DOC-04 SC-15、`docs/adr/ADR-constraints.md`
- トレーサビリティ: `docs/trace/gate-l3-fr017-trace.md`

## 1. 背景

FR-017は「時間重複、移動不足、営業時間外、予約不一致、滞在不足、予算超過、休憩不足、最終交通逸失、
未確認情報を検出し、ERROR/WARNING/INFOに分類、根拠・影響・修正候補を示す」「検証不能を問題なしにしない」
ことを求める。Gate L2で制約(FR-016)を登録できるようになったが、旅程に照らした判定が無かった。

## 2. 決定

### 2.1 テーブル(migration `c3e8a1f47d20`、additiveのみ)

| テーブル | 役割 |
|---|---|
| `validation_runs` | 検証1回分。入力の版(`input_revision`・`input_fingerprint`)、`algorithm_version`、状態(completed/failed)、件数、`summary_json`(検証できなかった件数の内訳・制約ごとの結果) |
| `validation_issues` | 問題1件。`kind`(violation=違反 / unverified=検証不能)、`severity`(ERROR/WARNING/INFO)、対象(予定・区間)、制約ID、根拠(evidence)・修正候補(suggestion) |

- DOC-05の `validation_issues.resolved_at` は持たない。結果は検証時点の写しであり、再検証で消えたものが解消済み。
- `plan_id`・`run_id`・`constraint_id` は `ON DELETE CASCADE`(プラン削除・制約の物理削除を妨げない)。
- 秘匿制約に関する問題は `constraint_owner_user_id` を必須にする(DB CHECK `ck_validation_issues_private_owner`)。
- プランごとに最新20件を残し、古いものから削除する(履歴の無制限な増加を防ぐ)。

### 2.2 API(DOC-06からの変更)

| DOC-06 | 本実装 | 理由 |
|---|---|---|
| `GET /validation-runs/{id}` | `GET /plans/{plan_id}/validation-runs/{run_id}` | 他のAPIと同じくプラン単位で権限を検査するため |
| (非同期ジョブを想定) | `POST /plans/{plan_id}/validation-runs` は同期実行・201 | 判定はDB読み出しと純粋関数だけで完結し十分速い。ジョブ基盤は最適化(FR-018)で必要になった時点で導入する |
| — | `GET /plans/{plan_id}/validation-runs?limit=` | 画面が最新結果を取得するため(結果が無くても404にしない) |

- 権限: viewer以上(検証はデータを変えない)。結果はプランのメンバー全員が見られる。
- `is_stale`: 旅程(プランrevision)・制約・予約・予約×イベント紐付け・区間の版の組み合わせのハッシュが
  検証時点と異なれば `true`。制約はプランrevisionを進めない(ADR-constraints §2.4)ため、ハッシュに含める。

### 2.3 判定(`app/services/feasibility.py`、`feasibility-v1`)

DBからの読み出し(`load_snapshot`)と判定(`evaluate`、純粋関数)を分ける。判定は推定で「問題なし」にしない。

| 検出 | 区分 | 判定できない場合 |
|---|---|---|
| 時間の重なり(終了が分かる予定の途中に次が始まる) | ERROR | — |
| 同じ開始時刻 | WARNING | — |
| 終了が開始以前 | ERROR | — |
| 移動時間不足(所要+準備+前バッファ > 前の終了から次の開始まで) | ERROR | 前の終了が不明で開始同士でも足りない→ERROR、足りる→検証不能(STAY_LENGTH_UNKNOWN) / 所要不明→検証不能 |
| 到着予定が次の開始より後 | ERROR | — |
| 紐付いた予約が取消済み | ERROR | — |
| 主予約の時刻と予定の開始が15分超ずれる | WARNING | — |
| 営業時間外・休業日(登録がある場所のみ。深夜営業に対応) | ERROR | 未登録は件数のみ数える(opening_hours_unknown) |
| 開始時刻未定の予定 | — | 検証不能(EVENT_TIME_UNKNOWN) |

制約(hard→ERROR、soft→WARNINGで重みを根拠に含める):

| 制約 | 判定 |
|---|---|
| 時刻 before/after/between | 適用範囲の予定の開始・終了をその日の現地時刻と比べる。終了が必要で不明なら検証不能 |
| 予算 max/min(通貨単位) | 取消以外の予約金額＋区間費用の合計(同じ通貨のみ)。別通貨・日付不明の費用は検証不能として別に示す。個人・予定単位は内訳が無いため検証不能 |
| 疲労 max/min(分・時間・km) | 1日ごとの区間の所要時間・距離の合計 |
| 食事の間隔 max/min | 1日の食事(event_type=dining)の開始の間隔 |
| 避けたい移動手段 | 値(「タクシー」「新幹線」等)を区間のmodeへ対応付けて判定 |
| その他の文字条件(avoid/not_equals) | 予定の名称・説明・住所に含まれれば「違反の可能性」。含まれなくても内容までは判定できないため検証不能 |
| prefer/equals 等 | 検証不能(手動確認) |

制約ごとの結果は `satisfied`/`violated`/`unverified`/`not_applicable`(適用対象の予定が無い)。

### 2.4 秘匿制約

- 判定には復号した値を使う(FR-016「詳細非表示のまま判定へ使う」)。
- 問題の文面・根拠・修正候補・`summary_json` に制約の値・題名を保存しない。文面は固定文
  (「秘匿制約を満たしていません/満たしていない可能性があります(内容は作成者本人にだけ表示されます)」)。
- 読出時、作成者本人には制約の題名を付け、他のメンバー(プラン所有者を含む)には根拠・修正候補も返さない(`is_masked`)。
- 復号できない秘匿制約は検証不能(CONSTRAINT_UNAVAILABLE)として示す。
- 残るリスク: 対象の予定(例:「寿司 えび専門店」)は共有データのため表示される。どの予定が秘匿制約に
  抵触したかから内容を推測できる場合がある。「判定に使う」以上は避けられず、画面で秘匿制約である旨を明示する。

### 2.5 失敗時

判定中の例外は500にせず、`status=failed`・件数0の結果として保存し、画面は「検証に失敗しました。問題が無いとは
限りません」と表示する(失敗を問題なしと誤表示しない)。

## 3. スコープ外

- 最終交通逸失の時刻表照合、滞在時間の目安(場所の標準滞在時間データが無い)、休憩の自動判定。
- 修正候補の適用(ワンクリック修正)と最適化への反映(FR-018、Gate L4)。
- 検証結果の変更通知、旅程画面への問題の重ね表示。
