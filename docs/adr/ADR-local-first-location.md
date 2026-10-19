# ADR: Local-first Location と適応型GPS記録(Gate L5、FR-055・FR-056)

- 状態: 採用(2026-10-19)
- 関連: DOC-15 CA-013・CA-014、`backend/app/api/v1/location_tracks.py`・`app/services/location_tracks.py`・
  `app/api/v1/atlas.py`、`frontend/src/pages/LocationTrackPage.tsx`・`src/utils/adaptiveSampler.ts`・
  `src/utils/areaCells.ts`・`src/store/trackingStore.ts`・`src/components/location/RecordingIndicator.tsx`、
  migration `f2a6c8e4b1d7`、トレース `docs/trace/gate-l5-trace.md`。前提は Gate P13(`ADR` なし、FR-038)

## 背景

P13 で任意の位置軌跡(同意必須・旅行期間限定・精度選択・「この端末だけ」か「暗号化してサーバーへ」)を入れたが、
CA-013 の「旅行単位で 端末内のみ/暗号化同期/記録しない を選ぶ」「集計済みの訪問地域だけを同期する」、CA-014 の
「移動速度・停止・電池・精度に応じた取得頻度」「アプリ内で常時明示」「低電力・手動記録」「電池の消費と欠測率の観測」が無かった。

## 決定

1. **旅行ごとの位置の扱い**(`trip_location_settings`、本人の分だけ): `off`(記録しない)/ `device_only` / `areas_only` / `synced`。
   行が無い = まだ選んでいない(記録は始まっていない。初期値 OFF の考え方)。`off` では始められず、記録中に `off` へ変えると止まる
   (`stopped_reason=mode_off`)。記録中に保存先を変えることはできない。If-Match(未設定は 0)。記録を始めたこと自体も選択として残す
   (P13 の API との互換)。
2. **訪問地域だけ同期**(`areas_only`): 生の座標は端末(localStorage)にだけ置き、サーバーは 0.1度(約11km)の区画の印・最初と最後の時刻・
   滞在時間・点の数だけを受ける(`location_area_cells`)。区画は Atlas の region と同じ格子・同じ印。サーバーは格子に乗らない・期間外・
   滞在が時間幅を超える区画を拒否する。同じ区画は合わせる(時刻を広げ、滞在時間・件数は大きい方)ので送り直してよい。
   Atlas では滞在時間で STAYED(30分以上)/ VISITED(10分以上)/ PASS_THROUGH として扱う(根拠の種類 `area`)。
   区画は粗い位置なので暗号化せずに持つ(Atlas の出力と同じ粒度)。本人以外には見せず、書き出し・時間帯の削除・軌跡の削除・
   アカウント削除・旅行の完全削除で一緒に扱う。
3. **適応型の取得**(端末の純粋関数 `decideTier`): 省電力(手動、または電池20%以下で充電していない)> 停止(3分以上ほぼ同じ場所)>
   乗り物(時速約29km以上)> 移動。停止・省電力では連続の取得(watchPosition)をやめて数分ごとの1回の取得(getCurrentPosition)へ
   切り替える。ブラウザでは geofence・significant-location-change が使えないため、その代わりの手段。「今の場所を記録」で手動の点を残せる。
4. **記録の観測値**(`location_tracks.sampling`): 取れるはずの回数・残した数・欠測・手動の数・最大の空き・段階ごとの時間・電池の始めと終わり。
   サーバーは数値だけを受け(座標・知らない項目は 422)、欠測率と電池の消費(充電を挟んだら null)を計算する。端末は画面を離れても
   数え続けられるよう観測値を端末にも置き、戻った時は多く数えている方から続ける。
5. **常時の表示**: どの画面でも、記録中(一時停止中)の軌跡があることを上部に示す。位置の取得はブラウザの制約で記録の画面を開いている
   間だけなので、ほかの画面では「位置は取っていない」とも示す。状態は ID と状態だけ(座標を持たない)。

## 結果・限界

- バックグラウンドでの記録(画面を閉じても取る)はブラウザではできない(ネイティブアプリ・PWA の Background Geolocation が必要)。
- 写真の EXIF からの位置の記録は未実装(P12 の写真は EXIF を読まない。CA-009 の公開時の除去と合わせて別 Gate)。
- 電池の情報は Chrome 系だけ(Safari・Firefox は getBattery が無い)。無い時は電池による省電力の自動切り替えをしない(手動は使える)。
- 「AI入力から正確な位置を除外」は、AI を使っていないため対象が無い(AI を入れる時に SEC-26 で扱う)。
- 区画の大きさは 0.1度で固定(都市の中の細かい訪問は分からない)。より細かい区画を同期する選択肢は設けない(プライバシーのため)。
