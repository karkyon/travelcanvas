# Gate LP トレース(ランディングを景色の主画面・動く画面イメージ・旅の流れ・正直な料金へ作り直す)

対象: 監査 2026-10-30(UI/UX 再監査)Gate LP、LP 案 `tc-lp-concept-v2-01-cinematic.html`。migration なし・API の変更なし・
FR の状態の遷移なし(DOC-10 は変えない。FR-058 の料金は未決のまま)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: E2E = `frontend/e2e/gate-lp.spec.ts`・`a11y.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 主画面: 景色の写真(3枚が入れ替わる)+影の重ね、見出し・説明・始めるボタン・「旅の流れを見る ↓」 | IMPLEMENTED | `pages/LandingPage.tsx`・`pages/landing/landing.css`、E2E(3枚の画像が 200・image/webp) |
| 2 | 動く画面イメージ: 相談→計画→旅行当日→思い出 を自動で切り替え、押すと止まる。一時停止・再開のボタン。「画面イメージ」の表示 | IMPLEMENTED | E2E(6秒以内に次へ・押した段に合う・旅の流れの段と同じ) |
| 3 | 01 PLAN YOUR WAY / 02 ENJOY THE DAY / 03 KEEP THE MOMENT。DOC-10 で使える機能だけを「利用できます」と書き、推定・未接続は文で示す(文章の読み取りは規則・移動は直線の推定・位置は画面を開いている間だけ) | IMPLEMENTED | E2E(本文) |
| 4 | 利用者の評価・星・利用者数を出さない。価格・「/月」・使える量の約束を書かない | IMPLEMENTED | E2E(本文に該当の文字が無い) |
| 5 | 料金: いま(料金なし)/Plus・Family(準備中)。購入の導線なし。FR-059 の 50 円は原価の上限で価格ではないため出さない | IMPLEMENTED | E2E |
| 6 | 最後の呼びかけ「あなたの次の旅を、描きはじめよう。」+ゲストで試す+アカウントを作る | IMPLEMENTED | E2E(押すと /planner) |
| 7 | 動きを減らす設定で自動の切り替え・動きを止める。暗い見た目・360px で横にはみ出さない。キーボードで操作できる(段のボタンは aria-pressed) | IMPLEMENTED | E2E(reducedMotion・dark・360px・axe) |
| 8 | 押せる部品を動かさない(浮かぶ演出は後ろの飾りの影だけ) | IMPLEMENTED | `landing.css` の `.lp-demo::before`、E2E を 3 回繰り返して合格 |
| 9 | ランディングでは共通の上の帯(ヘッダー)を出さない(ページ内の案内を持つため) | IMPLEMENTED | `components/Layout.tsx`、E2E(`global-header` 0 件) |

## 画像の出どころ(ライセンス)

| ファイル | 大きさ | sha256(先頭) | 出どころ |
|---|---|---|---|
| `frontend/public/lp/scene-1.webp` | 202,716 B・1672×941 | `c74647dad097ccfc` | 利用者が渡した LP 案 v2-01 に埋め込まれた画像。案の表記は「AI-GENERATED TRAVEL SCENES · ORIGINAL CONCEPT VISUALS」(AI で生成した独自の画像)。実在の写真・第三者の素材ではない |
| `frontend/public/lp/scene-2.webp` | 278,096 B・1672×941 | `859e9c97a3991efd` | 同上 |
| `frontend/public/lp/scene-3.webp` | 239,928 B・1672×941 | `c29b433fe9d2fb7a` | 同上 |

画面には「画像: AI で生成した旅の情景(イメージ)」と書く。CSP は `img-src 'self'` のまま(外部から読まない)。
最初に読む JS は増やさない(ランディングは遅れて読む部分)。

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-30) |
|---|---|
| 見た目 | 1440px(明)・360px(暗)・動きを減らす設定で撮って確かめた |
| E2E | `gate-lp.spec.ts`・`a11y.spec.ts` を 3 回繰り返して 12 合格。1回目は「最後の呼びかけ」の薄い文字のコントラスト 4.45(基準 4.5)→ 文字の色を濃く。浮かぶ演出が押すボタンを動かして押せなかった → 飾りの影だけに移した |
