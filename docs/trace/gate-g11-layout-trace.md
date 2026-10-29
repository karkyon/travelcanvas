# Gate G11-Layout トレース(旅程の画面の一覧のずれ・競合の後に最新を読み直せない時の表示)

対象: ハンドオフ 2026-10-30i §3 の残り 2(一覧のずれ)・3(二端末の競合の表示)。`docs/trace/gate-e2e-drag-trace.md` の「残り」、
`docs/trace/gate-g11-icons-trace.md` の検証の ②(gate-g8:182 がサンドボックスで1回だけ失敗)。
migration なし・API の変更なし・FR の状態の遷移なし(DOC-10 は変えない)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: FE = vitest、E2E = `frontend/e2e/gate-g11-layout.spec.ts`。

## 1. 一覧のずれ(レイアウトのずれ)

サンドボックスで測った値(API の応答を 800ms 遅らせ、予定の一覧の上端の位置を 100ms ごとに記録):

| 原因 | ずれ | 直す前 |
|---|---|---|
| 「この旅行の AI・外部検索の利用枠」(`PlanningUsageMeter`)が読み込み中は何も出さず、読み終わると現れる | 142px(枠 126px + 下の余白 16px) | 1775px → 1941px |
| 地図の下の「この日の移動概算」の行が、概算を読み終わってから現れる(地図の枠が 444px → 468px) | 24px | 同上(合計 166px) |
| 表紙の「写真を設定」のボタン(権限が後から分かる) | 0px(表紙に重ねて置いている) | — |

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 利用枠は読み込み中も同じ枠・見出し・帯・行の並びで場所を確保する(値は作らない: 金額は「—」、帯は空、meter を出さない) | IMPLEMENTED | `components/planning/PlanningUsageMeter.tsx`(`planning-usage-loading`)、FE `PlanningUsage.test.tsx` |
| 2 | 利用枠を読めない時も同じ枠で「読めませんでした(外部の有料の提供元は呼びません)・予定の編集はそのまま使える」と出し、もう一度読める | IMPLEMENTED | `planning-usage-failed`・「もう一度読む」、FE |
| 3 | 移動概算の行を 読み込み中・読めた・読めない・一部不明 の同じ1行にする(値を作らない。ゲスト・日が無い時は出さない) | IMPLEMENTED | `components/planner/RouteSummaryLine.tsx`、`PlannerPage.tsx`(`routePreviewStatus`)、FE `RouteSummaryLine.test.tsx` |
| 4 | 利用枠・移動概算の応答を一覧が見えた後まで止めても、読み終わった後の一覧の位置が変わらない(2px 以内) | IMPLEMENTED | E2E「予定の一覧の上の表示が遅れて読み終わっても、一覧の位置が変わらない」 |
| 5 | 利用枠の高さは状態(上限・警告の知らせ・ゲスト)で読み終わった後に少し変わり得る。既定(Free・未接続・知らせ無し)と同じ行の並びで確保した | PARTIAL | 知らせが出る状態(残りが少ない・上限)では、読み終わった時に知らせの1行の分だけ一覧が下がる(知らせを見落とさないための表示のため、隠さない) |

## 2. 競合の後に最新を読み直せない時の表示(FR-020)

原因の見立て: 保存が 409 になると、store は保存の前の内容に戻してから最新を読み直す(`_reconcileOnConflict` → `loadPlan`)。
読み直しが失敗しても(サンドボックスの同じ回には、前の実行の Redis の残りで別の試験が 429 になっていた)store は古い内容のまま残り、
画面は古い内容と比べて「ほかの人が変えた項目はこの画面の項目にはありません」と**言い切っていた**。backend の log は次の起動で
上書きされ、gate-g8:182 の失敗がこの経路だったかは確かめられていない(以後のサンドボックスの実行では再現しない)。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 6 | `loadPlan` は通信で最新の日程を取れた時だけ true を返す(端末の保存の内容・旅行の情報だけ読めた時・失敗は false) | IMPLEMENTED | `store/planStore.ts`、FE `planStore.test.ts` |
| 7 | 409 の後に読み直せなかった時は `conflict_unread` を返し、「最新の内容を再読み込みしました」と知らせない | IMPLEMENTED | `_reconcileOnConflict`・`updateScheduleItem`、FE |
| 8 | 編集の画面は、読み直せなかったことと、どの項目が変わったか(削除を含む)を示せないことを出す。入力は残す。重ねて保存は出さない | IMPLEMENTED | `utils/editConflict.ts`(`unreadConflict`)、`PlannerPage.tsx`(`edit-conflict-unread`)、FE `PlannerPage.collab.test.tsx`、E2E |
| 9 | 「最新を読み直して違いを確かめる」で読み直し、読めたら相手が変えた項目を示して重ねて保存できる(読めない間は表示を変えない) | IMPLEMENTED | FE(読み直しの失敗 → そのまま → 成功 → 違い → 重ねて保存)、E2E(本物の backend で 409 → 日程の読み直しだけを 503 にする → 読み直す → 「開始時刻: ほかの人の値「09:30」」→ 保存) |

## 3. 範囲の外

- 二端末の競合の E2E(gate-g8:182)の不安定の原因の確定: 上の 6〜9 で、読み直せなかった場合も誤った説明を出さないようにした。
  CI・サンドボックスで再び失敗したら、backend の log を残して原因を調べる(再試行で隠さない)
- issue #10 の経過観察(main の `b75c645` の push の CI は flaky 0。閉じるのはこの後の CI でも出ないのを見てから)

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-30) |
|---|---|
| 全検証(`verify.sh` 17 項目) | **失敗 0**。backend 1,298 合格・2 飛ばし、vitest 923 合格・標準エラー 0 行、tsc・lint・build、最初に読む JS 428.64 kB(上限 430 kB。前は 427.83 kB)。1回目は trace を足した後に索引を作り直していなかったため `test_trace_index_lists_every_trace…` が失敗 → 作り直して合格 |
| E2E(対象) | `gate-g11-layout.spec.ts`・`gate-g7.spec.ts`・`gate-g8.spec.ts` の 9 件合格・再試行 0 |
| E2E(全件・Redis と DB を空にして) | **93 合格・失敗 0・再試行 0**。接続元の点数は時間窓の最大 60(遮断 150)・遮断 0 |
