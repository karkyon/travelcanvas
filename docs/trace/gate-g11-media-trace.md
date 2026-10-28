# Gate G11-Media トレース(G11 の段階1: 旅行の表紙の写真)

対象: `docs/ux/G11_UIUX全範囲_実装仕様.md`(G11 の正本)§1・§2.1・§3.1・UIX-M10・UIX-M11・UIX-M13。利用者が 2026-10-28 に
案A(`travel_plans.cover_memory_id`)を承認し、G11 の全範囲を入れる決定をした。migration `a7c3e5f9b2d4`(down `f4d8a2c6e9b1`)。
FR-037 は顔の検査・MEMORY MAP(外部の提供元)が残るため INTEGRATED(部分)のまま(gates に G11 を足しただけ)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BE = `backend/tests/test_gate_g11_media_cover.py`、
FE = `frontend/src/components/trip/CoverPhoto.test.tsx`、CV = `frontend/src/styles/cover.test.ts`、
E2E = `frontend/e2e/gate-g11-media.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | migration: 表紙の写真(FK・SET NULL・部分の索引)・位置(0〜100)・拡大(100〜300)の CHECK・予定の写真・記録の出典・候補の `social`。往復で構造が一致 | IMPLEMENTED | `backend/alembic/versions/a7c3e5f9b2d4_gate_g11_media_cover.py`、BE `test_db_constraints`、CI の往復 |
| 2 | 表紙の API(GET・PUT・PATCH・DELETE・media)。editor 以上が変える、閲覧者は 403。同じ旅行の写真だけ、他人の非公開は存在も知らせず 404 | IMPLEMENTED | `backend/app/api/v1/plan_cover.py`・`services/plan_cover.py`、BE `test_set_move_clear_and_media`・`test_rejects_wrong_records` |
| 3 | 非公開の写真を表紙にしても公開範囲を変えない。他のメンバーには一覧・ダッシュボード・表紙の API・配信のどこにも出ない。メンバーに公開すると見える | IMPLEMENTED | BE `test_private_cover_not_leaked_to_members`、E2E |
| 4 | 配信は撮影情報(GPS・機種)を除去し `no-store`・`nosniff`・CSP sandbox。公開 URL を作らない(画面は Blob の一時の URL) | IMPLEMENTED | `memories.media_response`、BE、`hooks/useCoverPhoto.ts`、FE |
| 5 | 記録の削除(ゴミ箱)で表紙が外れる。複製は表紙をコピーしない。`PUT /travel-plans` で変わらない | IMPLEMENTED | BE `test_delete_clone_and_plan_update` |
| 6 | 表紙は旅程の revision を進めない(旅程の If-Match と競合させない)。仕様 r1 の If-Match の案から変更し、仕様を直した | IMPLEMENTED | 仕様 §2.1、`plan_cover.py` の docstring |
| 7 | TripCover の写真: 暗い重ね(白い文字が真っ白の写真の上でも 4.5:1)・位置と拡大・出典・読めない時は色の表紙 | IMPLEMENTED | `components/trip/TripCover.tsx`、`styles/tokens.ts` `COVER_PHOTO_SCRIM`、`styles/tokens.css`、CV、FE |
| 8 | 選ぶ画面: 旅行の写真から選ぶ(公開範囲を表示)・取り込む(非公開で保存・形式と上限・撮影情報を除く旨)・位置と拡大(range と ± のボタン)・3つの大きさのプレビュー・非公開の注意・外す・失敗の理由 | IMPLEMENTED | `components/trip/CoverPhotoDialog.tsx`、FE、E2E |
| 9 | 見出し・ダッシュボードの大きな表紙・旅行のカードが同じ写真を出し、変えたら全てを読み直す(`bumpCover`)。再読み込みしても続く | IMPLEMENTED | `PlanHeader.tsx`、`pages/dashboard/DashboardParts.tsx`、FE、E2E |
| 10 | 閲覧者には変える操作を出さない | IMPLEMENTED | `PlanHeader.tsx`(`can_edit`)、E2E |
| 11 | 360px・暗い見た目で横にはみ出さない・axe 違反 0 | IMPLEMENTED | E2E |
| 12 | 外部の写真の検索・取り込み(provider)、予定の写真の画面 | NOT STARTED | G11 段階3(gate/g11-discover) |
| 13 | 写真からの強調色の抽出 | NOT STARTED | `safeAccent()` は用意済み。G11 の範囲外(仕様に無い) |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(サンドボックス、2026-10-28) |
|---|---|
| backend pytest | 1,239 合格・7 飛ばし(新規 5 件を含む)。flake8 0、mypy 0(基準 0)、import の確認 |
| Alembic | upgrade → downgrade → upgrade の構造が一致(`app.ops.schema_snapshot`) |
| frontend | vitest 863 合格(170 ファイル)・標準エラー 0 行、tsc 0、lint 0、build、最初に読む JS 426.30 kB(上限 430 kB)、直書きの色の数は基準内 |
| E2E | 83 合格・再試行 0(全件。`gate-g11-media.spec.ts` 2 件を含む)。VERIFIED の E2E の証拠 40 件が合格 |
| 文書 | DOC-10・trace の目次・エラーの一覧の生成の一致、V3 再監査 R1〜R8 違反 0、secret の検査、npm audit 0 |

途中で見つけて直したこと: 見出しの「写真を設定」を権限の応答の後に表紙の下へ足していたため、予定の一覧が後から下へずれ、
`gate-g7.spec.ts` のドラッグの並べ替え(座標を測ってから動かす)が失敗した → ボタンを表紙の右上に重ねる配置にし、
他の要素の位置を動かさないようにした(同じ試験を3回連続で合格)。

CI・omega-dev2 の結果はこの表に含めない(PR で確かめる。omega-dev2 は未反映)。
