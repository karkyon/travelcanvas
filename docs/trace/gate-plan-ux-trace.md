# Gate PlanUX — 旅程の画面の移動手段・予定の編集・声の波形・始め方の写真の差し替え

正本: 利用者の UAT(2026-11-04 10:05)。
- 声の入力中の表示は、見本(細い縦線が中央から上下へ伸びる波形)の形で動かす。薄い緑の棒では分からない
- 旅程の一覧の始め方: 「行き先と日付だけで、旅行を作る」に「一人旅の旅程づくり」、「条件から、行き先を相談する」に「地図を囲む旅の相談」の写真
- 旅程の画面: 移動手段の印(徒歩〜ヘリ)を常に上に並べない。A から B へ移る所で印を押して移動手段を決め、新幹線などは時刻・予約番号などの詳細を後から入れる
- 予定のカードを押すたびに編集の画面が開く。編集は鉛筆から。時刻・営業時間は必須ではない。編集の画面の項目の大きさと内容を見直す

## 対応

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | 声の波形: 細い縦線 40 本を中央の線から上下へ。直近の声の大きさを右から入れて左へ流す。濃い色(暗い見た目では明るい色)。マイクを測れない時は飾りの波 | IMPLEMENTED | `ConsultInputs.useVoiceLevels`(時間の波形の二乗平均)、`tc-voice-wave` | `ConsultInputs.test.tsx` |
| 2 | 始め方の写真の差し替え(利用者提供) | IMPLEMENTED | `public/start/quick-plan.webp`(一人旅の旅程づくり)・`trip-consult.webp`(地図を囲む旅の相談) | 目視の UAT |
| 3 | 移動手段の印を常に並べない | IMPLEMENTED | `DayView`(凡例を外した) | `PlannerG11.test.tsx` |
| 4 | 予定と予定の間で「＋ 移動手段を選ぶ」→ 印を押して決める(区間を作る・変える。前後が合わない区間は今の前の予定から着く区間に直す) | IMPLEMENTED | `SegmentPicker`(移動区間の API。旅程の版で送り、保存の後に版だけ読み直す) | `SegmentPicker.test.tsx` |
| 5 | 移動の詳細を後から入れる: 出発・到着、列車名・便名、号車・座席・乗り場、所要時間、費用、メモ。予約番号は「予約」に保存(暗号化) | IMPLEMENTED | `SegmentDetailDialog` | `SegmentPicker.test.tsx` |
| 6 | 予定を押すと選ぶだけ(地図・右の欄)。編集は鉛筆から | IMPLEMENTED | `PlannerPage`・`ScheduleItem` | E2E(鉛筆から開く) |
| 7 | 編集の画面: 名前と種類 → 時間(任意・開始と終了を 1 行)→ 場所・住所 → メモ(見どころ・予約の要否・持ち物)。予約・費用の画面へのリンク | IMPLEMENTED | `PlannerPage`・`EventTimeImpact` | `PlannerPage.collab.test.tsx` |
| 8 | 時刻を決めていない予定に「時刻が無いため営業時間を照合できません」を出さない | IMPLEMENTED | `plannerModel.hoursBadge`・`SelectedEventCard` | `PlannerG11.test.tsx` |
| 9 | 下書きから旅程にする時、予定の種類を場所の種類に合わせる(食事・宿・買い物・体験) | IMPLEMENTED | `trip_intent.event_type_of` | `test_draft_event_type_follows_place_kind_then_part` |

**未対応(次の段階)**: 予定に場所の写真(Wikipedia の代表画像)を持たせ、右の欄の「場所画像のイメージ」を置き換える。

## 追補(2026-11-04 12:19 の UAT)

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 10 | 「条件から、行き先を相談する」の写真を、旅行の相談窓口(左がコーディネーター)の写真に差し替え(利用者提供) | IMPLEMENTED | `public/start/trip-consult.webp` | 目視の UAT |
| 11 | ゲストの始め方: 旅行相談は AI なしで使える(条件の整理・方面の比較・下書き)と示し、AI・おすすめの場所・Google は会員と示す。ボタンは使える | IMPLEMENTED | `PlannerPage` | `PlannerPage.test.tsx`(DashPlan) |
| 12 | ホーム(ダッシュボード)の改善案 v2: 精密モックアップ(PC・スマホ)と類似アプリの研究 | SPECIFIED | `docs/ux/TravelCanvas_ホーム改善案_v2_モックアップ.html` | — |
