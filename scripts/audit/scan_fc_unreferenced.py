"""[Gate② G2-09-D] DOC-02 v6.0 の FC-001〜100 のうち docs/trace から番号で参照されない FC を、
語の検索で「根拠の候補」に分ける(再生成できる。語の一致は根拠の候補であって、検証済みの意味ではない)。

    python3 scripts/audit/scan_fc_unreferenced.py .   # docs/audit/2026-11-19_fc001-100_unreferenced_scan.md を書く
"""
import re
import subprocess
import sys

r = sys.argv[1] if len(sys.argv) > 1 else '.'

# FC ごとの検索語(大文字小文字を区別しない拡張正規表現)。広い語は誤一致を含む
KW = {
    'FC-002': r'verify[_-]?email|email_verification|EmailVerification',
    'FC-003': r'change[_-]?password|password_change|ChangePassword',
    'FC-004': r'lockout|account_lock|failed_login|login_attempt',
    'FC-005': r'transfer[_-]?owner|ownership_transfer|owner_transfer',
    'FC-006': r'duplicate_plan|clone_plan|plan_copy|copy_plan|duplicatePlan',
    'FC-007': r'template',
    'FC-008': r'trash|restore_plan|purge_at',
    'FC-009': r'time_undecided|undated|unscheduled|time_window|tbd',
    'FC-010': r'multi[_-]?day|spans_days',
    'FC-011': r'recurr|rrule|repeat_rule',
    'FC-012': r'bulk|batch_update|change_set|changeset',
    'FC-014': r'autosave|auto-save|auto_save|自動保存|保存中',
    'FC-015': r'今日へ|jumpTo|jump_to|scrollToDay|日付へ',
    'FC-016': r'timezone_id|tz_display|ambiguous|DST',
    'FC-017': r'depends_on|dependency|precondition|prerequisite',
    'FC-018': r'buffer_min|buffer',
    'FC-021': r'speech|voice|transcri|SpeechRecognition',
    'FC-022': r'natural[_-]?language|parse_text|quick_add|quickAdd|intake',
    'FC-024': r'favorite|favourite|wish_place|WishPlace',
    'FC-026': r'report_candidate|candidate_report|flag_place|correction',
    'FC-029': r'meeting_point|meetup|rendezvous|集合',
    'FC-031': r'price_range|admission|ticket_price|fee',
    'FC-032': r'accessibility|wheelchair|stroller|step_free',
    'FC-033': r'MapLayer|map_layer|layer',
    'FC-034': r'share_policy|redact|public_map',
    'FC-035': r'hotel|lodging|check_in|checkin',
    'FC-036': r'flight|pnr|terminal|boarding',
    'FC-037': r'train|rail|car_number|seat',
    'FC-038': r'restaurant|dining|allerg',
    'FC-039': r'activity|experience|voucher',
    'FC-040': r'rental_car|car_rental|rentacar|レンタカー',
    'FC-041': r'cancel|amend|supersed',
    'FC-043': r'qr',
    'FC-044': r'pkpass|apple_wallet|google_wallet|add_to_wallet',
    'FC-045': r'document_version|replace_document|supersede',
    'FC-046': r'passport|visa',
    'FC-047': r'insurance|emergency_contact',
    'FC-048': r'receipt',
    'FC-049': r'leg|segment',
    'FC-050': r'transfer_margin|transfer_buffer|connection_time|乗換',
    'FC-051': r'last_train|last_entry|curfew|終電',
    'FC-052': r'parking|fuel|charging',
    'FC-053': r'locker|luggage|baggage',
    'FC-054': r'rest_break|meal_gap|max_continuous|休憩',
    'FC-056': r'opening_hours|OpeningHours|closed_days',
    'FC-057': r'arrival_buffer|受付終了|late_tolerance|遅刻',
    'FC-059': r'partial|is_locked|lock_items',
    'FC-060': r'fairness|min_satisfaction|vote',
    'FC-061': r'invite|invitation',
    'FC-063': r'base_revision|revision_conflict',
    'FC-064': r'read_receipt|acknowledg',
    'FC-075': r'departure_notice|leave_by|depart',
    'FC-076': r'gate_change|platform_change|ゲート変更|番線',
    'FC-077': r'weather',
    'FC-078': r'closure|closed|replan',
    'FC-079': r'emergency',
    'FC-080': r'location_share|share_location|location_track|LocationTrack',
    'FC-081': r'offline_pack|OfflinePack',
    'FC-082': r'revoke|expires_at|expiry',
    'FC-083': r'operation_id|idempoten',
    'FC-084': r'clock_skew|server_time|skew',
    'FC-085': r'low_power|battery|reduced_motion|prefers-reduced',
    'FC-086': r'lock.?screen|ロック画面|notification_privacy|redact_notification',
    'FC-093': r'exif|taken_at',
    'FC-094': r'public_journal|journal.*publish|publish',
    'FC-095': r'learning|consent',
    'FC-096': r'support_access|SupportAccess|support-access|support_session',
    'FC-100': r'status_page|incident|maintenance',
}

# 人が読んで確かめた所見(語の一致だけでは決められないもの)。根拠はコードを読んだ範囲
NOTES = {
    'FC-014': ('試験根拠なし', '自動保存の文言・処理は画面4か所(SettingsPage・SearchSettingsPage・SpotListPage・PlannerPage)にあるが、'
               '「失敗時の下書き保持・再送の冪等性」を固定する試験が見当たらない'),
    'FC-044': ('未実装(将来要件)', '要件自体が「将来提供」。pkpass 等の実装なし(Wallet の語は財布のアイコン・持ち物の候補だけ)'),
    'FC-086': ('要件との差異の候補', 'Web Push の本文に予定名・出発/開始の時刻を既定で入れている(backend/app/services/today_push.py の '
               'depart_messages・morning_message・rain_messages)。「旅程詳細をロック画面に既定表示しない」と食い違う可能性がある。'
               '予約番号は入れていない。仕様の判断が要る(コードは変えていない)'),
    'FC-096': ('根拠あり(候補)', 'backend/tests/test_gate_g2_support_access.py と docs/adr/ADR-support-access.md(目的付きの支援・監査)'),
    'FC-040': ('試験根拠薄', 'レンタカーの語はコードに多いが、試験の一致は fixture だけ'),
    'FC-010': ('根拠未特定', '予定(TravelEvent)は1つの日(day_id)に属する。end_at は日をまたいで入れられるが、'
               '開始〜終了の各日へ表示する処理・試験は見当たらない(宿泊は予約・移動区間の側で扱う可能性。要確認)'),
    'FC-057': ('試験根拠薄', '到着の余裕・受付終了・遅刻許容を名前で扱うコードは見当たるが、試験の一致なし'),
    'FC-076': ('試験根拠薄', '便・列車の状態変化と旧値の履歴を固定する試験は見当たらない(番線などの語の一致のみ)'),
}


def files(pat, paths, globs):
    cmd = ['grep', '-rliE', pat] + [f'--include={g}' for g in globs] + paths
    return subprocess.run(cmd, capture_output=True, text=True, cwd=r).stdout.split()


spec = open(f'{r}/docs/spec/DOC-02_要件定義書_v6.0.md', encoding='utf-8').read()
fcs = re.findall(r'^\| (FC-(?:0\d\d|100)) \| ([^|]+) \| ([^|]+) \|', spec, re.M)
assert len(fcs) == 100, len(fcs)
traced = set(subprocess.run(['grep', '-rhoE', 'FC-0[0-9]{2}|FC-100', 'docs/trace'],
                            capture_output=True, text=True, cwd=r).stdout.split())
un = [f for f in fcs if f[0] not in traced]
assert set(KW) == {f[0] for f in un}, sorted(set(KW) ^ {f[0] for f in un})

rows, counts = [], {}
for fc, name, shall in un:
    pat = KW[fc]
    tests = sorted(files(pat, ['backend/tests'], ['*.py']) + files(
        pat, ['frontend/src', 'frontend/e2e'], ['*.test.ts', '*.test.tsx', '*.spec.ts']))
    code = sorted(f for f in files(pat, ['backend/app', 'frontend/src'], ['*.py', '*.ts', '*.tsx']) if '.test.' not in f)
    if fc in NOTES:
        cls, note = NOTES[fc]
    elif tests:
        cls, note = '語の一致あり(要確認)', ''
    elif code:
        cls, note = 'コードのみ(試験の一致なし)', ''
    else:
        cls, note = '一致なし', ''
    counts[cls] = counts.get(cls, 0) + 1
    sample = ', '.join(f'`{t}`' for t in tests[:2]) or '—'
    rows.append(f'| {fc} | {name.strip()} | {shall.strip()} | `{pat.replace("|", "／")}` | {len(tests)} | {len(code)} '
                f'| {sample} | {cls} | {note} |')

out = [
    '# FC-001〜100 のうち docs/trace から参照されない FC の調査(G2-09-D)\n',
    '作成: 2026-11-19 / 基準: main `dac0b51` / 生成: `scripts/audit/scan_fc_unreferenced.py`(再生成できる)\n',
    '> **読み方:** 「語の一致」は、FC の内容に対応する語をコード・試験から検索した結果で、**根拠の候補**にすぎない。'
    '一致があっても、その試験が FC の SHALL を満たすことを確かめたわけではない(誤一致を含む)。'
    '**未参照=未実装ではない。** 要件の削除・統合・状態の変更はしていない。\n',
    f'未参照: **{len(un)} 件**(FC-001〜100 の 100 件のうち、docs/trace が番号で参照するのは {100 - len(un)} 件)。\n',
    '## 1. 分類の集計\n', '| 分類 | 件数 |', '|---|---|',
] + [f'| {k} | {v} |' for k, v in sorted(counts.items(), key=lambda x: (-x[1], x[0]))] + [
    '\n## 2. 一覧\n',
    '| FC | 名前 | SHALL | 検索語 | 試験の一致 | コードの一致 | 試験の例 | 分類 | 所見 |',
    '|---|---|---|---|---|---|---|---|---|',
] + rows + [
    '\n## 3. 次の作業(利用者の判断を分ける)\n',
    '| # | 内容 | 状態 |', '|---|---|---|',
    '| 1 | FC-086(通知の秘匿): 本文に予定名・時刻を出す今の挙動を仕様として認めるか、既定で伏せるか | **利用者の判断待ち** |',
    '| 2 | FC-014(自動保存の失敗時の下書き保持・再送)の試験を追加する | 未着手(コードの PR で) |',
    '| 3 | 「語の一致あり」の各 FC を、試験の中身まで読んで docs/trace へ番号で結ぶ | 未着手(FC 単位の照合は別 Gate。'
    '`gate-hardening-trace.md` G-01) |',
]
open(f'{r}/docs/audit/2026-11-19_fc001-100_unreferenced_scan.md', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('OK', len(un), counts)
