# Gate G11-Style トレース(G11 の段階4: 見た目の系統)

対象: `docs/ux/G11_UIUX全範囲_実装仕様.md` §3.4、UIX-M01・UIX-M11。migration なし(アカウントの保存は既存の
`users.preferences["ui_style"]`)。DOC-10 の状態は変えない(FR の証拠に当たらない見た目の設定)。

決定: 2026-10-28 18:00 の利用者の決定(ハンドオフ e §1)で4つの見た目を製品の設定にする。2026-10-29 の統合ハンドオフは
「比較用・4つの設定の実装は要求ではない」と書くが、設定の既定は「標準」(G10 のまま)なので、選ばない利用者の見た目は
変わらず、両方の資料に反しない。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: FE = `frontend/src/styles/styles.test.ts`・
`components/design/ThemeRoot.test.tsx`・`components/settings/StylePicker.test.tsx`、BE = `backend/tests/test_gate_g11_style.py`、
E2E = `frontend/e2e/gate-g11-style.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 標準・Atlas・Editorial・Daylight・Studio を設定 → 表示 で選べる(明るい・暗い・端末に合わせる とは別の軸) | IMPLEMENTED | `components/settings/StylePicker.tsx`(radio・矢印キー)、FE、E2E |
| 2 | `<html data-style>` と CSS 変数の上書きだけで当てる(画面の部品は変えない)。系統ごとの明暗の値を `tokens.ts` に持ち、`tokens.css` の生成の部分と一致を試験 | IMPLEMENTED | `styles/tokens.ts`(`STYLE_TOKENS`・`renderStyleCss`)、`styles/tokens.css`(`generated:styles`)、`components/design/ThemeRoot.tsx`、FE |
| 3 | Atlas の地 `#f5f4ee`・角 16px、Editorial の見出しの明朝、Daylight のボタン 48px・太め、Studio の地図の枠だけすりガラス | IMPLEMENTED | `renderStyleCss`、`Button`(`tc-btn`)、`PlannerPage`(`tc-map-frame`)、E2E |
| 4 | 全ての系統 × 明暗で文字と地の AA(本文 4.5:1・部品 3:1) | IMPLEMENTED | `styleTextPairs`(76 組)、FE、E2E(axe 違反 0) |
| 5 | 端末(`tc.style`)とアカウント(`preferences.ui_style`)に保存。会員はアカウントの値を優先(ログイン・refresh の応答にも `ui_style`)。形の違う値は保存しない・当てない。ゲストは端末だけ | IMPLEMENTED | `hooks/useThemePreference.ts`、`api/v1/auth.py`(`UI_STYLES`・`UserResponse.ui_style`)、BE、FE、E2E |
| 6 | モックの系統の切り替えの帯は製品に置かない | IMPLEMENTED | E2E |
| 7 | 1440px・360px、明暗で axe 違反 0・横にはみ出さない(ダッシュボード・プランナー・設定) | IMPLEMENTED | E2E |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-29) |
|---|---|
| backend | pytest 1,262 合格・2 飛ばし(新規 `test_gate_g11_style.py` 5件を含む)。flake8 0、mypy 0(基準 0)、alembic 往復の構造一致。migration なし(head `b8d4f6a0c3e5` のまま) |
| frontend | vitest 888 合格・標準エラー 0 行、tsc 0、lint 0、build、最初に読む JS 427.28 kB(上限 430 kB)、npm audit 合格 |
| E2E(全件) | **87 合格・失敗 0・再試行 0**(新規 `gate-g11-style.spec.ts` 2件: 4系統 × 明暗 × 1440px・360px × 3画面で axe 違反 0) |
| その他 | secret-scan 合格、DOC-10 の検査(変更なし)・trace の索引・エラーの一覧 最新 |
