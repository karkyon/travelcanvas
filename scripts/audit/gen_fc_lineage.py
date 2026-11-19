import json, re, sys
repo = sys.argv[1]
spec = open(f'{repo}/docs/spec/DOC-02_要件定義書_v6.0.md', encoding='utf-8').read()
status = json.load(open(f'{repo}/docs/trace/fr-status.json', encoding='utf-8'))['features']
reqs = json.load(open(f'{repo}/docs/trace/fr-requirements.json', encoding='utf-8'))['features']

# v5.1 保管版(02_要件定義書_v5.1.md)から読み取った FR ごとの値: (名前, CA, Gate)。80行はこの5観点×16FR
V51 = {
 43: ('Quick Plan','CA-001','G1'), 44: ('Guest Travel View','CA-002','G2'), 45: ('安全な共有Policy','CA-003','G2'),
 46: ('画像/PDF出力','CA-004','G2'), 47: ('旅程複製','CA-005','G1'), 48: ('Offline Travel Pack','CA-006','G2'),
 49: ('Visited Area Layer','CA-007','G4'), 50: ('訪問判定・信頼度','CA-008','G4'), 51: ('訪問訂正・Privacy除外','CA-009','G4'),
 52: ('Personal Travel Atlas','CA-010','G6'), 53: ('Journey Completion Metrics','CA-011','G6'), 54: ('Plan-to-Memory','CA-012','G4'),
 55: ('Local-first Location','CA-013','G4'), 56: ('適応型GPS','CA-014','G4'), 57: ('Memory Replan','CA-015','G6'),
 58: ('Entitlement/価格体系','CA-016','G6'),
}
ASPECTS = [
 ('作成・入力','正常入力、未定値、境界値を保存する'),
 ('認可・Policy','role/action/purpose/field判定を強制する'),
 ('状態遷移','許可遷移、guard、副作用、終端状態を保証する'),
 ('失敗・回復','圏外、競合、外部障害、再送で情報を失わない'),
 ('監査・試験','event、metric、単体/契約/E2E/SEC証拠を生成する'),
]
# v6.0 の FR 表(§3)を読む
v60 = {}
for m in re.finditer(r'^\| FR-(0(?:4[3-9]|5[0-8])) \| ([^|]+) \| (CA-\d+) \| [^|]+ \| (G\d) \|', spec, re.M):
    v60[int(m.group(1))] = (m.group(2).strip(), m.group(3), m.group(4))
assert sorted(v60) == list(range(43, 59)), sorted(v60)
# v6.0 §9.10 の規則と5観点が v5.1 と同じか
sec = spec[spec.index('### 9.10 子要件 FC-101'):spec.index('## 10. 例外')]
for name, shall in ASPECTS:
    assert f'| {name} | {shall} |' in sec, name
assert 'FC-(101+5k)〜FC-(105+5k)' in sec and 'CA-(001+k)' in sec

rows, problems = [], []
for k, fr in enumerate(range(43, 59)):
    n51, ca51, g51 = V51[fr]
    n60, ca60, g60 = v60[fr]
    if (n51, ca51, g51) != (n60, ca60, g60):
        problems.append((fr, V51[fr], v60[fr]))
    st = status[f'FR-{fr:03d}']; rq = reqs[f'FR-{fr:03d}']
    nt = len(rq.get('tests', []))
    for i, (aname, shall) in enumerate(ASPECTS):
        fc = 101 + 5 * k + i
        rows.append((fc, fr, ca60, n60, aname, shall, g60, st['status'] + ('(部分)' if st.get('partial') else ''), nt, st['gaps']))
ids = [r[0] for r in rows]
assert ids == list(range(101, 181)) and len(rows) == 80 and len(set(ids)) == 80
assert not problems, problems

out = []
out.append('# FC-101〜180(80行)の系譜表: v5.1 保管版 → v6.0\n')
out.append('作成: 2026-11-19 / 基準: main `dac0b51` / 生成: `scripts/audit/gen_fc_lineage.py`(再生成できる)\n')
out.append('> **訂正(重要):** 2026-11-18 の台帳 G2-09-C は「FC-101〜180が DOC-02 v6.0 に無い」と書いたが、**誤りだった**。'
           'v6.0 には §9.10 に「規則で書く」形で入っている(FC-(101+5k)〜FC-(105+5k) = FR-(043+k) の5観点、CA は CA-(001+k)、Gate は §3 の表)。'
           '本書はその規則で80行を展開し、v5.1 の値と機械的に突き合わせた結果である。\n')
out.append('## 1. 突き合わせの結果(機械検査)\n')
out.append('| 検査 | 結果 |\n|---|---|')
out.append('| FC 番号が 101〜180 で連続・重複なし・80行 | 合格 |')
out.append('| 親 FR 16件(FR-043〜058)の 名前・CA・Gate が v5.1 と v6.0 §3 で一致 | 合格(16/16) |')
out.append('| 5観点(作成・入力/認可・Policy/状態遷移/失敗・回復/監査・試験)と SHALL の文が v5.1 と v6.0 §9.10 で一致 | 合格(5/5) |')
out.append('| v6.0 §9.10 の規則(FC・CA・Gate の式)が存在する | 合格 |\n')
out.append('**分かったこと:** (a) 80行は v6.0 で**継承されている**(規則表現。情報は減っていない)。(b) v5.1 の表は見出しが5列なのに各行が6列(名前と観点が「名前: 観点」で1つに合わさっている)という体裁の不整合があった。v6.0 の規則表のほうが整っている。'
           '(c) **FC 単位の状態は台帳に無い**(DOC-02 as-built:「子要件 FC-001〜180 は個別の状態を台帳に持たない。親 FR の主な不足で管理」)。したがって下表の状態・証拠は**親 FR の値**であり、FC 個別に検証済みという意味ではない。\n')
out.append('## 2. 80行の系譜\n')
out.append('分類は全行「v6.0へ継承(規則表現)」。要件の削除・統合・廃止は**していない**(判断票も不要)。FC 個別の検証は未実施のため、証拠の列は親 FR のもの。\n')
out.append('| FC | 親FR | CA | 親FRの名前 | 観点 | 実装可能なSHALL(v5.1) | Gate | v6.0 | 親FRの状態(DOC-10) | 親FRの試験数 | 親FRの主な不足 |')
out.append('|---|---|---|---|---|---|---|---|---|---|---|')
for fc, fr, ca, n, a, s, g, st, nt, gaps in rows:
    out.append(f'| FC-{fc} | FR-{fr:03d} | {ca} | {n} | {a} | {s} | {g} | §9.10の規則で継承 | {st} | {nt} | {gaps.replace("|", "/")} |')
out.append('\n## 3. 残る判断・未了(利用者の判断が必要なものを分ける)\n')
out.append('| # | 内容 | 状態 |\n|---|---|---|')
out.append('| 1 | FC-101〜180 を v6.0 に「80行の表」として戻すか、現行の規則表現のままにするか | **利用者の判断待ち**(現状は規則表現で情報は等価。戻すなら DOC-02 の変更統制に従う) |')
out.append('| 2 | FC 単位(180件)で試験・コード・画面へ照合する | **未了**(FR 単位まで。`gate-hardening-trace.md` の G-01 が NOT STARTED) |')
out.append('| 3 | FC-181〜185 | FR-059 正本の受入条件側にのみ存在(`gate-fr059*-trace.md`)。DOC-02 の FC 表には無いのは仕様どおり |')
open(f'{repo}/docs/audit/2026-11-19_fc101-180_lineage.md', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('OK rows', len(rows))
