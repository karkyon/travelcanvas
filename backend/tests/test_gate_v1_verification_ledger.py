"""[Gate V1] DOC-10 の VERIFIED の判定の証拠(docs/trace/v1-verification-ledger.json)が実在することを確かめる。

VERIFIED = E2E・権限・競合・セキュリティ・運用を検証した機能(DOC-10 §1)。台帳の各機能について:
- E2E の spec が frontend/e2e に実在し、test(...) を含む
- 権限・競合(または対象外の理由)・セキュリティの各欄が空でなく、参照した backend の試験の関数が実在する
- 横断の証拠(全ルートの認可の網羅・ログの漏れの検査・運用)も実在する
参照した試験を消したり名前を変えると、この試験が落ちる(証拠の無い VERIFIED を残さない)。

リポジトリの根(docs・frontend)が無い場所(omega-dev2 の backend コンテナ)では飛ばす。CI の backend ジョブで必ず走る。
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / "docs" / "trace" / "v1-verification-ledger.json"

pytestmark = pytest.mark.skipif(not (LEDGER.is_file() and (ROOT / "frontend" / "e2e").is_dir()),
                                reason="リポジトリの根が無い(backend コンテナの中)")


def _ledger():
    return json.loads(LEDGER.read_text(encoding="utf-8"))


def _exists(ref: str) -> bool:
    if "::" in ref:
        path, name = ref.split("::", 1)
        p = ROOT / path
        if not p.is_file():
            return False
        return re.search(r"^def %s\(" % re.escape(name), p.read_text(encoding="utf-8"), re.M) is not None
    p = ROOT / ref
    return p.is_file() and ("test(" in p.read_text(encoding="utf-8") if ref.startswith("frontend/e2e/") else True)


def test_every_reference_exists():
    doc = _ledger()
    missing = []
    for block in ("authz", "security", "ops", "ops_docs"):
        for ref in doc["cross_cutting"][block]:
            if not _exists(ref):
                missing.append(f"cross_cutting.{block}: {ref}")
    for fr, f in doc["features"].items():
        for col in ("e2e", "authz", "conflict", "security"):
            for ref in f.get(col, []):
                if not _exists(ref):
                    missing.append(f"{fr}.{col}: {ref}")
    assert not missing, "台帳が参照する証拠が見つかりません:\n" + "\n".join(missing)


def test_verified_features_have_every_kind_of_evidence():
    doc = _ledger()
    assert doc["features"], "台帳が空です"
    problems = []
    for fr, f in doc["features"].items():
        assert re.match(r"^FR-0\d\d$", fr)
        if f["status"] != "VERIFIED":
            continue
        if not any(r.startswith("frontend/e2e/") for r in f["e2e"]):
            problems.append(f"{fr}: E2E が無い")
        if not any("::" in r for r in f["authz"]):
            problems.append(f"{fr}: 権限の試験が無い")
        if not f["conflict"] and not f.get("conflict_na"):
            problems.append(f"{fr}: 競合の試験も、対象外の理由も無い")
        if not f["security"]:
            problems.append(f"{fr}: セキュリティの試験が無い")
    assert not problems, "\n".join(problems)


def test_verified_features_are_named_by_an_e2e_spec():
    """[Gate G10-Q] V3: VERIFIED の機能は、台帳の E2E のうち少なくとも1本がその FR の番号を名乗る(spec の説明に書く)。

    以前は FR-001・002・006・044 の spec に番号が無く、どの試験が何の証拠かを台帳だけでしか追えなかった。
    """
    missing = []
    for fr, f in _ledger()["features"].items():
        if f["status"] != "VERIFIED":
            continue
        texts = [(ROOT / r).read_text(encoding="utf-8") for r in f["e2e"] if r.startswith("frontend/e2e/")]
        if not any(re.search(r"\b%s\b" % fr, t) for t in texts):
            missing.append(fr)
    assert not missing, "E2E の spec に FR の番号がありません: %s" % missing


def partial_features():
    """[Gate G1] (部分)の機能は docs/trace/fr-status.json が正本(以前はこの試験に一覧を直書きしていた)。"""
    status = json.loads((ROOT / "docs" / "trace" / "fr-status.json").read_text(encoding="utf-8"))
    return {fr for fr, f in status["features"].items() if f["partial"]}


def test_partial_features_are_not_listed_as_verified():
    """DOC-10 で「(部分)」の機能(未達の能力が残る)を VERIFIED にしない。"""
    partial = partial_features()
    assert len(partial) >= 1
    verified = {fr for fr, f in _ledger()["features"].items() if f["status"] == "VERIFIED"}
    assert not (verified & partial), sorted(verified & partial)
