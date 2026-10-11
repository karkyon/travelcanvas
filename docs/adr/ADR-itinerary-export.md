# ADR: カレンダー・地図・表計算への書き出し(FR-036)の最小実装

- 状態: 採用(Gate P5)
- 前提: Gate P4(しおり・印刷)適用後
- 関連: DOC-02 FR-036 / FC-091(ICS)/ FC-092(KML・GPX)、DOC-04 SC-27、DOC-11
- トレーサビリティ: `docs/trace/gate-p5-trace.md`

## 1. 背景

FR-036(Calendar/Map IO)は「孤立したMapView」があるだけで、ICS・GPX・KML・CSVの入出力はどれも無かった。
旅程を普段のカレンダーや地図アプリで見たいという需要は大きい一方、書き出したファイルはアプリの権限管理の外へ出るため、
含める情報を絞る必要がある。

## 2. 決定

### 2.1 書き出しだけを実装する(取込は次のGate)

- `GET /plans/{id}/exports/calendar.ics | places.gpx | places.kml | itinerary.csv`(viewer以上)。DB変更なし。
- 応答はファイル。`X-Export-Count`(書き出した件数)・`X-Export-Skipped`(時刻・位置が無く書き出さなかった件数)・
  `X-Export-Excluded`(利用者の選択で除外した件数)を返し、画面は必ず案内する(黙って欠落させない)。
  CORSの `expose_headers` に追加した。
- 外部カレンダー・地図からの取込(差分確認後の適用)は、取込候補の保存・差分表示・承認が必要なため今回は行わない。

### 2.2 含める情報(全形式共通)

- 予約番号・PIN・チケット・メモ(description)・参加者名は、どの形式にも含めない。
  予約が紐付く予定には「予約あり(予約番号はアプリで確認)」とだけ書く。
- 住所(ICSのLOCATION・CSVの住所列)は利用者が選んだ時だけ含める。施設名は常に含める。

### 2.3 ICS(FC-091)

- RFC 5545: CRLF、75オクテットでの折り返し(UTF-8の文字を分断しない)、`\ , ;` と改行のエスケープ。
- UIDは予定・移動ごとに固定(`event-{id}@travelcanvas.app`)。SEQUENCEは旅程の版(revision)で、
  再取込したカレンダーアプリが更新として扱える。取消済みの移動は `STATUS:CANCELLED`、確定(ロック)した予定は `CONFIRMED`。
- 時刻はUTC(`Z`)で出す。VTIMEZONEを持たないアプリでもずれない。表示用に `X-WR-TIMEZONE` を付ける。
- 時刻が未定の予定に推測の時刻を付けない。終日予定「(時刻未定)」として出す。出発時刻の無い移動は出さず件数で示す。

### 2.4 GPX・KML(FC-092)

- 既定は位置を小数2桁(約1km)に丸め、宿泊場所(種類が宿泊、または宿泊予約が紐付く予定)を除外する。
  正確な位置(小数5桁)・宿泊場所を含めるのは利用者の選択。精度はファイル内(GPXのmetadata・KMLのdescription)に明記する。
- 地点に加えて、日ごとの順路(GPXの `rte`、KMLの `LineString`)を出す。

### 2.5 CSV

- UTF-8 BOM付き(Excelで文字化けしない)、CRLF。数式の先頭文字(`= + - @` 等)で始まる値には `'` を付ける(CSV injection対策)。

### 2.6 監査

- `itinerary_exported`: 形式・選択(住所・精度・宿泊除外)・件数だけを記録する。予定名・住所・位置は記録しない。

## 3. 今回の範囲外

- ICS・GPX・KML・CSVの取込(差分確認後の適用)、Google/Apple Calendarとの直接連携(OAuth・購読URL)。
- 旅行単位・アカウント単位のデータエクスポート(FR-039)は次のGateで扱う。
