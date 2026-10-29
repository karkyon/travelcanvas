# Gate UX6-Icons トレース(旅程の中の移動・旅行の基本情報の飾りの絵文字を共通のアイコンへ)

対象: ハンドオフ 2026-10-30i §3 の残り 6、`docs/trace/gate-g11-icons-trace.md` の 5(移動手段以外の画面の飾りの絵文字)。
G11 の段階9(移動手段のアイコン)と同じ lucide の系統へ置き換える(UX-6 共通の部品)。migration なし・API の変更なし・
FR の状態の遷移なし(DOC-10 は変えない)。

理由: OS・ブラウザによって絵文字の形・色・幅が変わり、暗い見た目・4つの見た目の系統(G11 の段階4)の色に合わない。
読み上げではボタンの名前に絵文字の名前が混ざる(例:「太陽 今日」)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: FE = `frontend/src/components/common/UiIcon.test.tsx`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 共通の部品 `UiIcon`(lucide のアイコンを受け取り、読み上げから外す・文字の色に従う)。必ず文字と組にする | IMPLEMENTED | `components/common/UiIcon.tsx`、FE(svg・aria-hidden・ボタンの名前は文字だけ) |
| 2 | 旅程の中の移動(23 の入口: 当日・計画・予約と準備・一緒に・記録)を絵文字から `UiIcon` へ。名前の文字は変えない | IMPLEMENTED | `pages/PlannerPage.tsx`(Button の `icon`)。E2E は名前で探す(絵文字を含めて探していた 2 か所を直した) |
| 3 | 旅程の操作(元に戻す・地図を表示・オフラインで使う・近くのスポットの自動検出)・オフラインの知らせ・訪問の提案・プランの一覧の行き先 | IMPLEMENTED | 同上 |
| 4 | 旅行の基本情報(目的地・期間・人数・予算)と削除の確認の警告 | IMPLEMENTED | `components/PlanHeader.tsx` |
| 5 | この2つのファイルの画面の文字に絵文字(`Extended_Pictographic`・U+FE0F)を使わないことを試験で守る(`✦` のような文字の記号は対象外) | IMPLEMENTED | FE |
| 6 | ほかの画面の飾りの絵文字(検索・管理・設定・当日以外の画面など、約 39 ファイル)。`router/index.tsx` の 42 か所は注釈だけで画面に出ない。`components/layout/Header.tsx`・`components/Navbar.tsx` はどこからも使われていない | NOT STARTED | 画面ごとに置き換える(UX-6 の続き)。使われていない部品の削除は別に判断する |

## 試験の名前の変更(絵文字を含めて探していた所)

| 試験 | 前 | 後 |
|---|---|---|
| `e2e/document-wallet.spec.ts` | `{ name: /📄\s*文書/ }` | `{ name: '文書', exact: true }` |
| `e2e/gate-g8.spec.ts` | `{ name: '✏️ 訂正の申し出' }` | `{ name: '訂正の申し出', exact: true }` |

ほかの試験は名前の一部(`/予算・費用/` 等)で探しており、そのまま通る。

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-30) |
|---|---|
| 見た目 | 1280px(明・暗)・360px(暗)で旅程の中の移動を撮って確かめた。アイコンは文字の色に従い、暗い見た目でも同じ色 |
| 全検証(`verify.sh` 17 項目) | **失敗 0**。backend 1,298 合格・2 飛ばし、vitest 919 合格・標準エラー 0 行、tsc・lint・build・bundle |
| E2E(全件・Redis と DB を空にして) | **91 合格・失敗 0・再試行 0**(名前を直した `document-wallet`・`gate-g8` を含む)。接続元の点数は時間窓の最大 60・遮断 0 |
