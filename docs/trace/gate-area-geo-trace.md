# Gate AreaGeo — 方面の位置の誤り(③が北海道)・地図の範囲・観光の検索が空(UAT 2026-11-02 15:30 の指摘)

正本: 利用者の UAT の指摘(2026-11-02 15:30、出発 枚方・方面 伊勢/福井/滋賀/奈良)。
**omega-dev2 に配備したのは 6632d65 のまま**(PR #47・#48・#49 は未 merge)。下の修正は PR #49 の head に含む。実環境の確認は未実施。

| # | 指摘 | 原因(コード上) | 状態 | 実装 | 試験 |
|---|---|---|---|---|---|
| 1 | 方面の③が北海道に置かれた | 方面の位置を Nominatim の 1 件目(`limit=1`)だけで決め、同じ名前の別の場所を採った。出発地(枚方)の位置を引けない時は距離・上限の判定も飛んでいた | IMPLEMENTED | `jp_gazetteer.py`(47 都道府県の県庁・関西/北陸/中部などの代表の地名の内蔵の表)を先に引き、無い時だけ Nominatim(`limit=5`・場所の種類と重要度で選ぶ)。出発地も同じ。直線の距離が片道の上限×100km×2(上限なしは 600km)を越える位置は `suspect`(疑わしい)とし、理由を出す | `test_gate_area_geo.py`(枚方・伊勢・福井・滋賀・奈良が関西/北陸に留まる・遠い候補は suspect・Nominatim は重要な場所を選ぶ) |
| 2 | 地図が小さい・伊勢/福井/滋賀/奈良の範囲が見えない | 地図の枠が低い・外れた点(北海道)まで含めて範囲を合わせた | IMPLEMENTED | 地図の枠 `h-80 / sm 28rem / lg 34rem`。疑わしい位置・上限を越える方面は地図に置かない(一覧に理由)。`fitBounds` の余白 40px・最大の拡大 10・枠の大きさが変わったら合わせ直す | `Consult.test.tsx`(上限を越えそうな方面のピンを置かない) |
| 3 | OpenStreetMap で何も出ない | 公開の Overpass の時間切れ・429(配備は古い問い合わせのまま)。観光は Overpass だけに頼っていた | IMPLEMENTED(配備・実環境は未確認) | 観光(言葉なし・座標あり)は Overpass と Wikipedia の座標付きの記事(ja.wikipedia geosearch・半径は最大 10km・駅/学校などは除く)を並行して探す。Overpass が失敗しても Wikipedia の結果を並べ、出典を行ごとに示す(`出典: Wikipedia`) | `test_gate_area_geo.py`(Overpass の時間切れでも Wikipedia の結果・食事は Wikipedia を使わない)・`PlaceSearchPanel.test.tsx` |
| 4 | HOME の動画 4 種が出ない | 受け取った 4 本は透かし入りのプレビュー(Shutterstock)。公開リポジトリには入れられない | IMPLEMENTED(社内 UAT の見た目の確認だけ) | `HERO_SCENES_COMMITTED`(リポジトリ・空)が空の時だけ、配備先の手元の `heroVideos.local.json` と `public/hero/local/`(.gitignore の対象)を使う。`scripts/ops/install_hero_local.sh` が束の検証・配置・git の対象外の確認・画面の作り直し・200 video/mp4 の確認をする。配信は video の Range に答える | `HeroVideoBackground.test.tsx`(手元の一覧の検証)・`staticServer.test.ts`(206・416) |

残り: omega-dev2 での実環境の確認(方面の位置・地図・観光の検索・動画の切り替え)は **未実施**。本番の前に利用権のある版の動画へ差し替える(`docs/ux/home-hero-video-assets.md`)。
