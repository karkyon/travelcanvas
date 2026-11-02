# Gate HomeHeroVideo — HOME の「最初の旅行を始めましょう」の背景の動画(仕組み。素材は受け取り待ち)

正本: 「Claude 向け作業継続指示: UAT 開始・残課題・HOME 動画」(2026-11-02)§7。素材の台帳 `docs/ux/home-hero-video-assets.md`。
**素材はまだ受け取っていない**ため `HERO_SCENES` は空で、画面は以前と同じ山並みの絵(DOM も同じ)。

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | 対象は表紙の背景だけ。見出し・説明・ボタン・他の HOME・他の画面は変えない | IMPLEMENTED | `EmptyHero` の `.tc-home-hero-art` の中だけを `HeroVideoBackground` に。CSS は追加だけ | vitest(DashboardPage・HeroVideoBackground) |
| 2 | 4 本・7 秒ごと・短いクロスフェード・音声なし・cover | IMPLEMENTED | `HERO_ROTATE_MS 7000`・`HERO_FADE_MS 600`・muted・playsInline・object-fit cover | `4場面を 7秒ごとに順に切り替え…` |
| 3 | 4 本を一度に読まない(poster と今の場面だけ、次は必要な時) | IMPLEMENTED | 今の場面だけ `<source>` を付け、次は切り替えの 2.5 秒前。他は `preload="none"` | 同上 |
| 4 | タブが隠れた・画面の外は再生とタイマーを止め、戻ると残りから | IMPLEMENTED | visibilitychange・IntersectionObserver・残り時間の保持 | `タブが隠れた間・画面の外の間は…` |
| 5 | prefers-reduced-motion・Save-Data は静止の poster | IMPLEMENTED | 動画の要素を作らない | `動きを減らす設定では…` |
| 6 | 1 本が読めない時は次へ、全て読めない時は以前の絵。ボタンはいつも使える | IMPLEMENTED | `<source>` の最後の失敗・video の失敗で飛ばす | `読めない場面は飛ばして…` |
| 7 | 素材の台帳(名前・長さ・比率・解像度・codec・容量・権利)、配信の形・容量の実測 | NOT_STARTED(本番の素材待ち) | 台帳の雛形。※ 2026-11-02 に受け取った 4 本は透かし入りのプレビューのため、社内 UAT の見た目の確認だけに配備先の手元へ置く(台帳 §2a、**Gate AreaGeo の #4**)。本番の版は未受領 | `HeroVideoBackground.test.tsx`(手元の一覧) |
| 8 | スマホ・PC の見た目・コントラスト・実機の転送量 | NOT_RUN(素材待ち) | — | — |

あわせて(F07 の残り F-03): 下書きの画面に「旅行相談で確かめた予算」(宿・旅行全体などを分けて)を表示する(`draft-budgets`)。
