# Gate G11-Discover トレース(G11 の段階3: 発見・SNS・外部の写真・予定の写真)

対象: `docs/ux/G11_UIUX全範囲_実装仕様.md` §2.2・§2.4・§3.3・§5、UIX-M08〜M10・M14。migration なし(G11-Media の
`travel_events.image_memory_id`・`memories.source`・`plan_candidates.source_kind='social'` を使う)。設定を3つ足した
(`IMAGE_PROVIDERS`・`SOCIAL_PROVIDERS`・`SOCIAL_INSTAGRAM_OEMBED_TOKEN`)。FR-007 は gaps を狭め、部分のまま。決定は `docs/adr/ADR-media-providers.md`。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BE = `backend/tests/test_gate_g11_discover.py`、
FE = `frontend/src/pages/discover/Discover.test.tsx`、E2E = `frontend/e2e/gate-g11-discover.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | provider の interface・設定で止める・値を作らない・上限・redirect を追わない | IMPLEMENTED | `services/media_providers/__init__.py`・`registry.py`、BE |
| 2 | Wikimedia Commons の候補(作者・ライセンス・出典・取得日時・取り込めるか)、決まった host だけ、SVG などの対応外は出さない | IMPLEMENTED | `services/media_providers/wikimedia.py`、BE `test_wikimedia_search_fetch_and_guards` |
| 3 | ライセンス: CC0・PD・CC BY・CC BY-SA だけ取り込める | IMPLEMENTED | `license_allowed`、BE `test_license_policy_and_plain_text`、FE、E2E |
| 4 | 取り込み: 非公開の記録・出典・撮影情報の除去・暗号化。表紙・予定の写真に使える。止めると使えない | IMPLEMENTED | `api/v1/media_providers.py`、`memories.save_photo`・`_store_media`、BE `test_import_external_saves_private_memory_with_source_and_cover` |
| 5 | 縮小画像の中継(ブラウザから外部へ直接読まない) | IMPLEMENTED | `GET /media-providers/images/thumb`、`components/media/ExternalPhotoPicker.tsx` |
| 6 | SNS: 公式の oEmbed だけ・投稿へ直接つながない・対応外/止めてある/鍵が無い/取れない を区別・題名は文字だけ・場所の候補は低/中・SSRF の URL を拒む | IMPLEMENTED | `services/media_providers/social.py`、BE `test_social_preview_variants_and_candidate`・`test_place_words_and_platform`、FE |
| 7 | 候補箱へ social で保存(platform と URL の一致・日時のタイムゾーン)。取れない時は URL とメモ | IMPLEMENTED | `api/v1/candidates.py`、`pages/discover/SocialImportCard.tsx`、BE、FE、E2E |
| 8 | 予定の写真: 編集できる人だけ・見えない写真は使えない・閲覧者に非公開の写真を出さない・記録の削除で外れる・複製はコピーしない | IMPLEMENTED | `api/v1/plan_cover.py`(event-images・events/{id}/image)、`components/planner/EventPhotoDialog.tsx`・`ScheduleItem.tsx`・`DayView.tsx`、BE `test_event_image_permissions_and_cleanup`、FE、E2E |
| 9 | 近くの検索: 基点(旅程の場所・現在地・座標)・半径・カテゴリ、距離、半径を保証するか、Overpass の正規表現の逃がし、入力の検証 | IMPLEMENTED | `services/search_provider.py`、`api/v1/search.py`、`pages/discover/NearbyDiscover.tsx`・`discoverModel.ts`、BE `test_nearby_search_validation_distance_and_escape`、FE、E2E |
| 10 | 表紙の選ぶ画面から外部の写真を探す(提供元が止めてあれば項目を出さない) | IMPLEMENTED | `components/trip/CoverPhotoDialog.tsx`、E2E |
| 11 | 360px で横にはみ出さない・axe 違反 0 | IMPLEMENTED | E2E |
| 12 | SNS 以外の URL の題名・画像の取得、顔の検査、提供元の応答のキャッシュ | NOT STARTED | ADR §3 |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-28) |
|---|---|
| backend pytest | 1,258 合格・1 飛ばし(新規を含む)。flake8 0、mypy 0(基準 0)。migration なし(head は `b8d4f6a0c3e5` のまま) |
| frontend | vitest 879 合格・標準エラー 0 行、tsc 0、lint 0、最初に読む JS 426.42 kB(上限 430 kB) |
| E2E(全件) | **85 合格・失敗 0・再試行 0**(新規 `gate-g11-discover.spec.ts` を含む。外部に頼る応答だけ `page.route` で差し替え、取り込みは本物の upload)。VERIFIED の E2E の証拠 40 件が合格 |
| 外部の provider | サンドボックスからは Commons・oEmbed・Overpass につながらない。BE は httpx の MockTransport、E2E は差し替えで確かめた。本物への接続は omega-dev2 で別に記録する |
