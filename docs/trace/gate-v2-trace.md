# Gate V2 トレース(FR-049 Visited Area Layer・FR-050 訪問判定・信頼度・FR-051 訪問訂正・Privacy除外)

基準: main `43b737a`(Gate A2)。migration `b3e8f1c6d2a4`(visit_assessments)。
B = backend `tests/test_gate_v2_visits.py`、U = vitest(`services/api/v2visits.test.ts`・`utils/visitMetrics.test.ts`・
`utils/protectedZones.test.ts`・`pages/visits/visitModel.test.ts`・`pages/VisitsPage.test.tsx`・`pages/LocationTrackPage.test.tsx`)、
E = `frontend/e2e/visits.spec.ts`。画面 `/planner/:planId/visits`(訪問の地図)。

## 判定の規則 visit-v1(DOC-14「v5.1 訪問判定・GPS・MAP性能」の初期値をそのまま使う)

| 規則 | 値 | 実装 |
|---|---|---|
| 推定の材料から除く精度 | accuracy > 100m | `visit_assessment.MAX_ACCURACY_M`(端末も同じ `visitMetrics.ts`) |
| 場所の半径 | 種類ごとに 50〜300m(食事50・会合75・買い物/その他100・体験/娯楽/宿泊150・観光200・自由時間/移動300) | `CATEGORY_RADIUS_M` |
| VISITED | 半径の中の有効な点2つ以上かつ2分以上(速さ 15km/h 以下) | `assess()` |
| STAYED | 10分以上 | 同上(地図の層では STAYED) |
| PASS_THROUGH | 速さ > 15km/h または 2分未満 | 同上(理由 fast / short を根拠に残す) |
| 信頼度 | 距離0.35・滞在0.25・精度0.15・証拠(写真/予約/手動の記録)0.25 | 小数第2位へ四捨五入 |
| 区分 | 0.80以上=高、0.50〜0.79=要確認、未満=候補 | `level_of()` |
| VERIFIED | 利用者の確認、または強い証拠2種以上(10分以上の滞在・写真・予約・手動の記録) | 自動の判定は LIKELY_VISIT 止まり |
| 版 | `visit-v1` | 判定ごとに algorithm_version を保存 |

同じ場所にいた続きとみなす点の間隔は30分まで(それより空いたら別の訪問とし、一番長い訪問を使う)。DOC-14 に値が無いため実装で決めた。

## FR-049 Visited Area Layer(CA-007)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 予定・通過・訪問・滞在・確認済み・非表示を地図に重ねる | IMPLEMENTED | 略図(SVG)の層。B `test_layer_state_mapping`、U、E |
| 2 | 単純な塗りつぶしにしない(計画・通過・滞在・確認を区別) | IMPLEMENTED | 6状態。E(滞在→確認済み、通過) |
| 3 | 色だけに依存しない(形・記号・文字) | IMPLEMENTED | ✓/◆/●/◌/○、線の種類、一覧の文字。axe(E) |
| 4 | 地図が使えない時の代わり(一覧) | IMPLEMENTED | 一覧で同じ内容。外部の地図サービスに頼らない略図 |
| 5 | 状態ごとの表示の切り替え | IMPLEMENTED | U・E |
| 6 | CANDIDATE(候補) | NOT STARTED | 候補箱(FR-007)が未実装のため層に無い |
| 7 | 実際の地図タイルの上への表示 | NOT STARTED | 地図の提供元の接続(MapView は Google Maps のキーが必要)が未整備 |

→ INTEGRATED(部分、E2E有)。

## FR-050 訪問判定・信頼度(CA-008)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 入力証拠: GPS座標・精度・滞在時間・移動速度・予定地点との一致 | IMPLEMENTED | `visit_metrics()`。B |
| 2 | 写真撮影・チケット(予約)利用・手動確認 | IMPLEMENTED | 写真の記録(予定に紐付け・半径の中で撮影)、予定に紐付けた予約、振り返りの「行った」。B `test_device_results_and_evidence` |
| 3 | 判定状態 VERIFIED_VISIT / LIKELY_VISIT / PASS_THROUGH / PLANNED_ONLY / MANUAL / REJECTED | IMPLEMENTED | DB の CHECK 制約・B |
| 4 | 信頼度・根拠・判定時刻・アルゴリズム版を保存 | IMPLEMENTED | visit_assessments.confidence / reasons / assessed_at / algorithm_version |
| 5 | 低信頼度では確定せず確認を求める | IMPLEMENTED | needs_confirmation(「確認してください」)。自動では VERIFIED にしない。E |
| 6 | 予定・実績を無断で変えない(不変条件4) | IMPLEMENTED | event_actuals を作らない。B |
| 7 | 判定をやり直しても本人の訂正を上書きしない | IMPLEMENTED | auto_state に最新の自動の判定を残し、差を画面に示す。B・U |
| 8 | 端末だけに座標を置くモードでも判定できる(FR-055) | IMPLEMENTED | 端末が数値だけを計算して送る `POST /visits/device-results`(座標の項目は 422)。B・U |
| 9 | 冪等(同じ材料で変わらない) | IMPLEMENTED | B(2回目は unchanged) |
| 10 | 他の人の軌跡を使わない・判定を見せない | IMPLEMENTED | 判定は本人だけ。B |

→ INTEGRATED(E2E有)。

## FR-051 訪問訂正・Privacy除外(CA-009)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 誤訪問を取り消せる | IMPLEMENTED | 「行っていない」(REJECTED)。E |
| 2 | 訪問・通過を変更できる | IMPLEMENTED | 「行った(確定)」「通過だった」「自動の判定に戻す」。If-Match。B・E |
| 3 | 時間範囲・旅行単位で GPS を削除できる | IMPLEMENTED | P13 の時間帯の削除・軌跡の削除。**削除すると自動の判定も消える(削除の伝播)**。B |
| 4 | 地点単位の除外 | IMPLEMENTED | 「地図から隠す」: 地図・Atlas に出さない。Atlas は隠した場所の半径の中の軌跡・記録も除く。B・E |
| 5 | 保護エリア(自宅・職場)を端末側で設定 | IMPLEMENTED | 記録の画面。端末(localStorage)だけに保存。中で取れた位置は保存・送信しない。U |
| 6 | 公開時に出発・帰着地点をぼかす | NOT APPLICABLE(現時点) | 位置の軌跡・訪問の判定・Atlas を公開・共有する機能が無い(本人だけ) |
| 7 | 写真 EXIF を同じ公開 Policy で除去 | NOT STARTED | 写真の記録(P12)は元のファイルのまま保存しており、EXIF(撮影位置を含むことがある)を除いていない。メンバーに公開した写真から撮影位置が分かりうる。次の Gate で対応する |
| 8 | 修正前後を監査し、生位置を監査ログへ複製しない | IMPLEMENTED | visit.correct(操作・前後の状態だけ)。予定名・座標を残さない。B |

→ INTEGRATED(部分、E2E有)。

## そのほか

- FR-052 Atlas の不足「地点単位の公開範囲」を、FR-051 #4 で埋めた。
- データの書き出し(FR-039)に visit_assessments(本人の分)を含め、アカウントの削除で消す。
- API: `GET/POST /plans/{id}/visits`・`/visits/assess`・`/visits/device-results`・`PATCH /visits/{event_id}`。
  応答の形は本物の backend から採取して固定(contract)。
