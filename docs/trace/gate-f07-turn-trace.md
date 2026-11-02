# Gate F07-Turn — 旅行相談の会話の1ターン(追加・訂正・削除・取消・矛盾・複数の予算)

基点: Gate SearchUAT-S3(PR #47)。正本: 「Claude への作業継続指示」(2026-11-02)§3 Stage C・§4 の 10 ターンの受入。
外への通信の試験は httpx.MockTransport と CI の E2E の模擬の提供元。**AI の答えは試験が決める。実の AI の会話の品質
(critical suite・macro F1・30 会話の評価)は未評価**で、omega-dev2 の実 AI の UAT で確かめる。

| # | 要件(Stage C) | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | Turn・Requirement・Proposal・Conflict・ConversationState に相当する状態。revision・安定した ID | IMPLEMENTED | 画面が持つ状態 `TurnState`(fields・budgets(ID)・notes(ID)・areas(候補/決定)・preferences・revision)。`consultTurnModel.turnStateOf`。サーバーは状態を保存しない | vitest `consultTurnModel.test.ts`・`test_clean_state_tolerates_bad_shapes` |
| 2 | 追加・訂正・削除/clear・質問を区別 | IMPLEMENTED | 操作 `set`・`clear`・`add/remove_preference`・`add/remove_note`・`add/update/remove_budget`・`area_candidate/decide/remove`、`questions`・`conflicts` | `test_ten_turn_scenario_state_is_kept_corrected_and_conflicts_are_not_resolved` |
| 3 | 確かめた条件を AI が黙って上書きしない。訂正は before → after の変更案。未言及の null で既存の値を消さない | IMPLEMENTED | 確かめた行への変更は `needs_confirmation`(項目は確認の表の変更案、予算・その他の希望・方面の取り消しは「確かめた条件への変更案」)。消すのは明示の clear・remove だけで、根拠が最新の発言にある時だけ | `test_api_turn_sends_latest_utterance_counts_one_call_and_logs_no_text`・vitest |
| 4 | 矛盾は双方の根拠と質問を返す。両立する条件は矛盾にしない | IMPLEMENTED | 同じターンで同じ項目に違う値 → 変更にせず `conflicts`(双方の根拠の語つき)。AI が返す conflicts も示す | ターン 8・`test_compatible_wishes_are_not_conflicts_and_unmentioned_fields_stay` |
| 5 | 予算は複数(額・通貨・全員/1人・何人分・対象・期間・上限/目安・根拠・確認) | IMPLEMENTED | 主な予算の行(`b-main`)+ 追加の予算(最大 6)。人数の変更で額・何人分かを計算し直さない。下書きの intent に `budgets`(確かめたものだけ) | ターン 2・4・5、`test_draft_keeps_multiple_budgets`、vitest |
| 6 | 新しい発言を黙って切らない。上限は明示 | IMPLEMENTED | 1ターン 1,000 文字(API・入力欄)。越えたら 422 `input_too_long`(送らない)。規則の読み取りの追加も上限を越えたら送らない(PR #47) | `test_api_turn_…`・vitest `ConsultInputs.test.tsx` |
| 7 | AI へは最新の発言 + 構造化の状態だけ。全履歴の再送・隠れた二重の AI 呼び出しをしない | IMPLEMENTED | `prompt_of` は【今の条件】(値・確認の状態・ID の JSON)と【最新の発言】だけ。1ターン = AI 1回 | `test_state_sent_to_ai_has_no_previous_utterances_or_evidence`・API の試験(送った本文) |
| 8 | AI の出力は strict schema の差分だけ。根拠の一致・ID・型/範囲をサーバーで検証 | IMPLEMENTED | `consult_turn.SCHEMA`(strict)。根拠が最新の発言に無い・知らない ID・範囲の外の操作は捨てて `dropped` に数える | `test_operations_without_evidence_or_target_are_dropped` |
| 9 | 10 ターン・同時・2つのタブ・Undo・取消・同じキーの再送 | PARTIAL | 10 ターン(サーバーの検証)・同じ Idempotency-Key の再送は 409 で二度送らない・Undo は状態だけ戻す(費用・回数は戻らない。既存の履歴)。2つのタブの同時の編集の衝突は未実装(状態は各タブの sessionStorage) | 上の試験 |
| 10 | 原文・文字起こし・AI の答えをサーバーのログに残さない。`store:false` だけで提供元が保持しないと説明しない | IMPLEMENTED | 監査は件数(changes・conflicts・dropped)だけ | `test_api_turn_…`(ログに発言が無い) |

## 未実施・残り

| 項目 | 状態 |
|---|---|
| 実 AI(gpt-5-nano)で §4 の 10 ターン(枚方・4人→3人・宿 6〜8万→宿の上限 8万・旅行全体 12万・伊勢/滋賀・市場の削除・日帰りと1泊の矛盾・伊勢に決定・温泉) | NOT_RUN(omega-dev2) |
| 30 会話以上の評価・critical suite 100%・macro F1 ≥ 0.95・原価の半減の比較(F07-5) | NOT_STARTED(人手の正解の付け方の準備が要る) |
| 2つのタブの同時の編集の検出(revision の衝突) | NOT_IMPLEMENTED |
| 下書きの画面での複数の予算の表示 | IMPLEMENTED(Gate HomeHeroVideo の PR で `draft-budgets`。閲覧だけで、下書きの画面での編集は未実装) |
