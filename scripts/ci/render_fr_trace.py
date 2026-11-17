#!/usr/bin/env python3
"""[Gate Hardening-A・監査 G-01/G-03] 要求の追跡の表を作る(標準ライブラリだけ)。

- docs/trace/FR-TRACE.md      … docs/trace/fr-requirements.json と fr-status.json から(全59 FR の要求の根拠・画面・API・表・試験・証拠の区分)
- docs/spec/CANONICAL-SOURCES.md … docs/spec/canonical-sources.json から(仕様の正本の所在)

    python3 scripts/ci/render_fr_trace.py          # 書き換える
    python3 scripts/ci/render_fr_trace.py --check  # 書き換えが要るなら 1

手で直さない(backend/tests/test_gate_hardening_trace.py が一致を確かめる)。直すのは JSON の方。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQ = ROOT / "docs" / "trace" / "fr-requirements.json"
STATUS = ROOT / "docs" / "trace" / "fr-status.json"
SOURCES = ROOT / "docs" / "spec" / "canonical-sources.json"
OUT_TRACE = ROOT / "docs" / "trace" / "FR-TRACE.md"
OUT_SOURCES = ROOT / "docs" / "spec" / "CANONICAL-SOURCES.md"

KINDS = ("requirement", "implementation", "integration", "e2e", "authz_failure", "device", "real_api", "ops")
MARK = {"done": "●", "partial": "◐", "pending": "○", "na": "—"}


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _cell(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def render_trace() -> str:
    req = _load(REQ)
    status = _load(STATUS)["features"]
    meta = req["_meta"]
    feats = req["features"]
    kinds = meta["evidence_kinds"]
    out = [
        "# 全59 FR の要求の追跡(Gate Hardening-A・監査 G-01/G-03)",
        "",
        "> この文書は `python3 scripts/ci/render_fr_trace.py` が `docs/trace/fr-requirements.json` と `docs/trace/fr-status.json` から作る(手で直さない)。",
        "> 要求の原文の正本は DOC-02 v6.0(`docs/spec/DOC-02_要件定義書_v6.0.md`。所在の一覧は [CANONICAL-SOURCES.md](../spec/CANONICAL-SOURCES.md))。ここの要約・受入は抜粋の言い換え。",
        "> 状態の正本は fr-status.json、VERIFIED の証拠は v1-verification-ledger.json。基準 commit `%s`。" % meta["baseline"][:7],
        "",
        "## 1. 証拠の区分の一覧",
        "",
        "● 証拠あり ◐ 一部 ○ 未実施・未確認 — 対象外。**実機・実 API・運用(本番)の ● は 0 件**(証拠の記録が無いものを完了にしない)。",
        "",
        "| FR | 機能 | 状態 | " + " | ".join(kinds[k] for k in KINDS) + " | 残件の分類 |",
        "|---|---|---|" + "---|" * len(KINDS) + "---|",
    ]
    totals = {k: {s: 0 for s in MARK} for k in KINDS}
    for fr, f in feats.items():
        st = status[fr]
        label = st["status"] + ("(部分)" if st["partial"] else "")
        cells = []
        for k in KINDS:
            s = f["evidence"][k]["state"]
            totals[k][s] += 1
            cells.append(MARK[s])
        out.append("| %s | %s | %s | %s | %s |" % (fr, _cell(f["title"]), label, " | ".join(cells),
                                                  "・".join(f["gap_categories"]) or "—"))
    out += ["", "| 集計 | " + " | ".join(kinds[k] for k in KINDS) + " |", "|---|" + "---|" * len(KINDS)]
    for s, m in MARK.items():
        out.append("| %s %s | " % (m, meta["evidence_states"][s]) + " | ".join(str(totals[k][s]) for k in KINDS) + " |")
    out += ["", "## 2. FR ごとの要求の根拠と対応", ""]
    for fr, f in feats.items():
        r = f["requirement"]
        out += [
            "### %s %s" % (fr, f["title"]),
            "",
            "- **出典:** %s(優先度 %s・段階 %s)" % (r["source"], r["priority"], r["stage"]),
            "- **要求(抜粋):** %s" % r["summary"],
            "- **受入(抜粋):** %s" % r["acceptance"],
        ]
        for c in f["approved_changes"]:
            out.append("- **承認済みの変更 %s:** %s(出典: %s・確度 %s)" % (c["date"], c["change"], c["source"], c["confidence"]))
        sc = "・".join(f["spec_refs"]["screens"]) or "(DOC-04 に画面 ID なし)"
        out += [
            "- **仕様の参照:** 画面 %s / API 群 %s" % (sc, f["spec_refs"]["api_group"]),
            "- **実装:** API %s / 画面 %s / 表 %s" % ("・".join("`%s`" % a for a in f["code"]["api"]),
                                                    "・".join("`/%s`" % x.lstrip("/") for x in f["code"]["routes"]),
                                                    "・".join("`%s`" % t for t in f["code"]["tables"])),
            "- **試験:** " + "・".join("`%s`" % t for t in f["tests"]),
            "- **外部の提供元:** " + ("・".join(f["external_providers"]) or "なし"),
            "- **証拠:** " + " / ".join("%s %s(%s)" % (kinds[k], MARK[f["evidence"][k]["state"]], f["evidence"][k]["note"])
                                       for k in ("device", "real_api", "ops")),
            "- **主な不足(fr-status.json):** %s" % status[fr]["gaps"],
            "",
        ]
    return "\n".join(out).rstrip() + "\n"


def render_sources() -> str:
    src = _load(SOURCES)
    meta = src["_meta"]
    out = [
        "# 仕様の正本の所在(Gate Hardening-A・監査 G-01/G-09)",
        "",
        "> この文書は `python3 scripts/ci/render_fr_trace.py` が `docs/spec/canonical-sources.json` から作る(手で直さない)。",
        "",
        meta["description"],
        "",
        "- 確認した日: %s(%s)" % (meta["checked_at"], meta["checked_by"]),
        "- 資料室: %s" % meta["location_library"],
        "",
        "## 優先の順",
        "",
    ]
    out += ["- %s" % p for p in meta["precedence"]]
    out += ["", "## v6.0 へ移す段階", ""]
    out += ["- 段階 %s: %s" % (k, v) for k, v in meta["stages"].items()]
    out += ["", "## 文書の一覧", "",
            "| ID | 文書 | 今の正本 | 版 | 状態 | 段階 | 役割 | 共通正本 | 保管・旧版(資料室) |",
            "|---|---|---|---|---|---|---|---|---|"]
    labels = {"approved_v6.0": "v6.0 正本", "approved_v5.1": "v5.1 正本(移す前)", "unverified_header": "v5.1(移す前・版の表記は未確認)",
              "merged": "統合済み"}
    for d in src["documents"]:
        where = "`%s`" % d["repo_path"] if d.get("repo_path") else ("資料室 `%s`" % d["library_path"] if d["state"] != "merged"
                                                                    else "・".join("`%s`" % x for x in d["repo_successors"]))
        archive = "`%s`(保管)" % d["library_path"] if d["state"] in ("approved_v6.0", "merged") else "—"
        out.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            d["id"], _cell(d["title"]), where, d["version"], labels[d["state"]], d["stage"], _cell(d["role"]),
            "○" if d.get("common_canonical") else "", archive))
    out += ["", "状態の語: " + " / ".join("%s=%s" % (k, v) for k, v in meta["states"].items()), ""]
    return "\n".join(out)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    pairs = ((OUT_TRACE, render_trace()), (OUT_SOURCES, render_sources()))
    if "--check" in argv:
        stale = [p.name for p, text in pairs if not p.is_file() or p.read_text(encoding="utf-8") != text]
        if stale:
            print("古い: %s(python3 scripts/ci/render_fr_trace.py を実行する)" % ", ".join(stale))
            return 1
        return 0
    for path, text in pairs:
        path.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
