# Gate G11-Vote トレース(G11 の段階8: 候補箱の家族・グループの投票)

対象: DOC-10 FR-007(候補箱)の gaps「候補への投票」・ハンドオフ 2026-10-29h §3 の 2。`docs/ux/G11_UIUX全範囲_実装仕様.md` §3.3。
**新しい表・migration なし**(合意形成 FR-022 の投票の選択肢を候補にする仕組み `poll_options.candidate_id` は G4 から既にある)。
FR-007 は(部分)のまま(OCR・音声認識・SNS 以外の URL の題名の取得が残る)。DOC-10 r29。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: FE = `frontend/src/pages/candidates/CandidateVoting.test.tsx`、
E2E = `frontend/e2e/gate-g11-family-vote.spec.ts`(2人の会員・閲覧のメンバー)。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 候補箱で、編集できる人が候補を選択肢にした投票を始める(20件まで) | IMPLEMENTED | `pages/candidates/CandidateVoting.tsx`、FE、E2E |
| 2 | メンバー(閲覧の人も)が候補ごとに 行きたい・行ってもいい・気になる・行きたくない を付け、もう一度押すと取り消す。ゲスト・共有の閲覧は不可(投票の API が viewer 以上) | IMPLEMENTED | 既存 `PUT /plans/{id}/polls/{poll_id}/votes`、FE、E2E(閲覧のメンバーが回答) |
| 3 | 気になる・行きたくないは理由が要る(代替案が要る投票ではそれも) | IMPLEMENTED | 既存の検証(422)と画面の入力、FE、E2E |
| 4 | 件数: 名前つきは全員の合計、匿名は3人の回答まで出さない | IMPLEMENTED | `candidateVotingModel.ts` `countsText`、FE、E2E |
| 5 | 投票の後に足した候補は「この投票に入っていません」と示す | IMPLEMENTED | FE、E2E |
| 6 | 決定・旅程への反映は話し合いの画面(既存 COL-02) | IMPLEMENTED | 既存 `gate-g4.spec.ts` COL-02、画面のリンク |
| 7 | 投票の選択肢の候補を応答に含める(frontend の型・decoder) | IMPLEMENTED | `services/api/types/discussion.ts`・`decoders.ts`(`candidate_id`) |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-29) |
|---|---|
| 全検証 | vitest 911 合格・標準エラー 0 行(1回目は回答のボタンの名前(記号は読み上げから外れる)と tsc の型で失敗 → 試験を直して合格)・backend・DOC-10 r29・V3 再監査 違反 0 |
| E2E(全件) | **91 合格・失敗 0・再試行 0**(新規 `gate-g11-family-vote.spec.ts`、段階7 の変更を含む) |
