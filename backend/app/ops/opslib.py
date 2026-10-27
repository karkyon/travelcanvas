"""[Gate O1] 運用(B-010: backup/restore・監視・rollback)の純粋関数。

設計方針:
- 標準ライブラリだけを使う。ホスト(omega-dev2)の ``python3`` から ``scripts/ops/tcops.py`` が
  そのまま import でき、コンテナ内の pytest でも同じ関数を検査できるようにするため。
- DB・docker・ファイルへの副作用は持たない(ファイルのハッシュ計算 ``sha256_file`` だけは例外)。
- 秘密(DBのパスワード・暗号鍵)を戻り値・文面に含めない。接続文字列を文面にする時は ``mask_url``。
- Python 3.8 でも動く書き方にする(ホストの python3 の版を固定できないため)。
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

TOOL_VERSION = "ops-v1"

# ---------------------------------------------------------------------------
# 接続文字列・DB名
# ---------------------------------------------------------------------------

_URL_RE = re.compile(r"^(?P<prefix>[a-zA-Z][a-zA-Z0-9+.\-]*://[^/]*)/(?P<db>[^?#]*)(?P<rest>[?#].*)?$")
_DB_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
_CRED_RE = re.compile(r"(?P<scheme>[a-zA-Z][a-zA-Z0-9+.\-]*://)[^/@\s]+@")
_KV_SECRET_RE = re.compile(r"(?i)\b(password|passwd|pwd|secret|token|api_key|key)=([^\s&;]+)")


def database_name(url: str) -> str:
    """接続文字列から DB 名を取り出す。取り出せなければ ValueError。"""
    m = _URL_RE.match(url or "")
    if not m or not m.group("db"):
        raise ValueError("接続文字列から DB 名を取り出せません")
    return m.group("db")


def replace_database(url: str, name: str) -> str:
    """接続文字列の DB 名だけを ``name`` に置き換える(ホスト・資格情報・パラメータは保つ)。"""
    if not _DB_NAME_RE.match(name or ""):
        raise ValueError("DB 名は英小文字で始まる英小文字・数字・_ の63文字以内にしてください")
    m = _URL_RE.match(url or "")
    if not m:
        raise ValueError("接続文字列の形式が不正です")
    return "%s/%s%s" % (m.group("prefix"), name, m.group("rest") or "")


def mask_url(text: str) -> str:
    """文面に含まれる ``scheme://user:pass@`` と ``password=...`` を伏せる。"""
    masked = _CRED_RE.sub(lambda m: m.group("scheme") + "***@", text or "")
    return _KV_SECRET_RE.sub(lambda m: m.group(1) + "=***", masked)


def check_drill_database_name(name: str, live_name: str) -> None:
    """復元演習・復元先に使う DB 名の安全確認。運用中の DB を絶対に上書きしない。

    - 英小文字・数字・_ だけ(シェル・SQL へ埋め込んでも解釈が変わらない)
    - 運用中の DB と同名は不可
    - ``restore`` を名前に含むこと(誤って別用途の DB を消さないため)
    """
    if not _DB_NAME_RE.match(name or ""):
        raise ValueError("復元先の DB 名が不正です(英小文字で始まる英小文字・数字・_ の63文字以内)")
    if name == live_name:
        raise ValueError("運用中の DB と同じ名前には復元できません")
    if "restore" not in name:
        raise ValueError("復元先の DB 名には 'restore' を含めてください(例: travelcanvas_restore_drill)")
    if name.endswith("_test") or "test" in name.split("_"):
        raise ValueError("試験用 DB(test を含む名前)は復元先にできません")


# ---------------------------------------------------------------------------
# バックアップの名前・manifest
# ---------------------------------------------------------------------------

_BACKUP_ID_RE = re.compile(r"^tc-(\d{8}T\d{6}Z)$")
BACKUP_FILE_SUFFIXES = {
    "database": ".db.dump",
    "uploads": ".uploads.tar.gz",
    "manifest": ".manifest.json",
    # [Gate G3] SEC-F5 データ鍵の写し(DB のダンプには含めない。破棄した鍵は全ての世代から消す)
    "keys": ".keys.jsonl",
}


def new_backup_id(now: datetime) -> str:
    if now.tzinfo is None:
        raise ValueError("now はタイムゾーン付きにしてください")
    return "tc-" + now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def parse_backup_id(backup_id: str) -> datetime:
    m = _BACKUP_ID_RE.match(backup_id or "")
    if not m:
        raise ValueError("バックアップIDの形式が不正です")
    return datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)


def backup_file_name(backup_id: str, role: str) -> str:
    parse_backup_id(backup_id)
    return backup_id + BACKUP_FILE_SUFFIXES[role]


def backup_ids_in(names: Iterable[str]) -> List[str]:
    """ディレクトリ内のファイル名から、manifest を持つバックアップIDを新しい順に返す。"""
    found = set()
    suffix = BACKUP_FILE_SUFFIXES["manifest"]
    for name in names:
        if name.endswith(suffix):
            bid = name[: -len(suffix)]
            if _BACKUP_ID_RE.match(bid):
                found.add(bid)
    return sorted(found, reverse=True)


def sha256_file(path: str, chunk: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def build_manifest(
    *,
    backup_id: str,
    created_at: datetime,
    git_commit: Optional[str],
    alembic_revision: Optional[str],
    source_database: str,
    files: Mapping[str, Mapping[str, object]],
    table_counts: Mapping[str, int],
    upload_files: Mapping[str, Mapping[str, object]],
    key_fingerprints: Mapping[str, Optional[str]],
) -> Dict[str, object]:
    """バックアップの目録。秘密は含めない(鍵は SHA-256 の先頭12桁の指紋だけ)。"""
    for role in ("database", "uploads"):
        if role not in files:
            raise ValueError("files に %s がありません" % role)
        info = files[role]
        if not re.match(r"^[0-9a-f]{64}$", str(info.get("sha256", ""))):
            raise ValueError("%s の sha256 が不正です" % role)
    return {
        "format": "travelcanvas-backup",
        "tool_version": TOOL_VERSION,
        "backup_id": backup_id,
        "created_at": created_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "git_commit": git_commit,
        "alembic_revision": alembic_revision,
        "source_database": source_database,
        "files": {role: dict(info) for role, info in files.items()},
        "table_counts": dict(sorted(table_counts.items())),
        "upload_files": {path: dict(info) for path, info in sorted(upload_files.items())},
        "key_fingerprints": dict(key_fingerprints),
    }


def manifest_problems(manifest: Mapping[str, object], actual: Mapping[str, Mapping[str, object]]) -> List[str]:
    """manifest と実際のファイル(role → {name, size, sha256})を突き合わせ、問題を文で返す。空なら健全。"""
    problems: List[str] = []
    if manifest.get("format") != "travelcanvas-backup":
        problems.append("manifest の形式が違います")
        return problems
    expected_files = manifest.get("files") or {}
    if not isinstance(expected_files, dict):
        return ["manifest の files が不正です"]
    roles = ["database", "uploads"] + (["keys"] if expected_files.get("keys") else [])
    for role in roles:
        exp = expected_files.get(role)
        got = actual.get(role)
        if not exp:
            problems.append("manifest に %s の記録がありません" % role)
            continue
        if not got:
            problems.append("%s のファイルがありません" % role)
            continue
        if int(got.get("size", -1)) != int(exp.get("size", -2)):
            problems.append("%s のサイズが記録と違います" % role)
        if got.get("sha256") != exp.get("sha256"):
            problems.append("%s のハッシュが記録と違います(破損・改変の可能性)" % role)
    return problems


def key_fingerprint(secret: Optional[str]) -> Optional[str]:
    """鍵そのものではなく、取り違えを検出するための指紋(SHA-256 の先頭12桁)。"""
    if not secret:
        return None
    return hashlib.sha256(("travelcanvas-key-fingerprint:" + secret).encode("utf-8")).hexdigest()[:12]


def fingerprint_mismatches(backup: Mapping[str, Optional[str]], current: Mapping[str, Optional[str]]) -> List[str]:
    """バックアップ時と現在で指紋が違う鍵の名前。どちらかが未設定の鍵は比較しない。"""
    names = []
    for name in sorted(set(backup) | set(current)):
        a, b = backup.get(name), current.get(name)
        if a and b and a != b:
            names.append(name)
    return names


# ---------------------------------------------------------------------------
# 保持期間(世代管理)
# ---------------------------------------------------------------------------


def select_backups_to_prune(
    backup_ids: Sequence[str],
    now: datetime,
    *,
    keep_daily: int = 7,
    keep_weekly: int = 4,
    keep_min: int = 3,
) -> List[str]:
    """削除してよいバックアップIDを返す(古い順)。

    残す規則(いずれかに当てはまれば残す):
    - 新しい方から ``keep_min`` 件
    - 直近 ``keep_daily`` 日の各日(UTC)で最も新しい1件
    - 直近 ``keep_weekly`` 週の各週(ISO週)で最も新しい1件
    - 未来の日時のもの(時計ずれ。消さない)
    """
    if keep_min < 1:
        raise ValueError("keep_min は1以上にしてください")
    dated = []
    for bid in backup_ids:
        try:
            dated.append((parse_backup_id(bid), bid))
        except ValueError:
            continue
    dated.sort(reverse=True)
    keep: Set[str] = set(bid for _, bid in dated[:keep_min])
    seen_days: Set[str] = set()
    seen_weeks: Set[Tuple[int, int]] = set()
    now_utc = now.astimezone(timezone.utc)
    for ts, bid in dated:
        if ts > now_utc:
            keep.add(bid)
            continue
        age = now_utc - ts
        day = ts.strftime("%Y-%m-%d")
        if age < timedelta(days=keep_daily) and day not in seen_days:
            seen_days.add(day)
            keep.add(bid)
        iso = ts.isocalendar()
        week = (iso[0], iso[1])
        if age < timedelta(weeks=keep_weekly) and week not in seen_weeks:
            seen_weeks.add(week)
            keep.add(bid)
    return sorted(bid for _, bid in dated if bid not in keep)


# ---------------------------------------------------------------------------
# 復元の検証
# ---------------------------------------------------------------------------


def compare_table_counts(
    source_before: Mapping[str, int],
    source_after: Mapping[str, int],
    restored: Mapping[str, int],
) -> Dict[str, object]:
    """復元先の表ごとの件数を、バックアップ直前・直後の元DBと比べる。

    - バックアップ中に元DBの件数が変わった表は ``unstable``(運用中の書き込み。失敗にしない)。
    - それ以外で件数が違う表、復元先に無い表、復元先にだけある表は失敗。
    """
    matched: List[str] = []
    unstable: List[str] = []
    mismatched: List[Dict[str, object]] = []
    missing = sorted(set(source_before) - set(restored))
    extra = sorted(set(restored) - set(source_before) - set(source_after))
    for table in sorted(set(source_before) & set(restored)):
        before = source_before[table]
        after = source_after.get(table, before)
        got = restored[table]
        if before != after:
            if got in (before, after) or min(before, after) <= got <= max(before, after):
                unstable.append(table)
            else:
                mismatched.append({"table": table, "source": before, "restored": got})
        elif got == before:
            matched.append(table)
        else:
            mismatched.append({"table": table, "source": before, "restored": got})
    return {
        "ok": not mismatched and not missing and not extra,
        "tables": len(set(source_before) | set(restored)),
        "rows": sum(int(v) for v in restored.values()),
        "matched": matched,
        "unstable": unstable,
        "mismatched": mismatched,
        "missing": missing,
        "extra": extra,
    }


def compare_file_listings(
    source: Mapping[str, Mapping[str, object]],
    archived: Mapping[str, Mapping[str, object]],
) -> Dict[str, object]:
    """保存ファイル(文書・写真・音声)の一覧(相対パス → size/sha256)を、アーカイブ内と比べる。"""
    missing = sorted(set(source) - set(archived))
    extra = sorted(set(archived) - set(source))
    changed = sorted(
        p
        for p in set(source) & set(archived)
        if source[p].get("sha256") != archived[p].get("sha256")
        or int(source[p].get("size", -1)) != int(archived[p].get("size", -2))
    )
    return {
        "ok": not missing and not changed,
        "files": len(archived),
        "bytes": sum(int(v.get("size", 0)) for v in archived.values()),
        "missing": missing,
        "extra": extra,
        "changed": changed,
    }


def safe_archive_member(name: str) -> bool:
    """tar の中のパスが展開先の外へ出ないか(絶対パス・..・空を拒否)。"""
    if not name or name.startswith("/") or "\\" in name:
        return False
    parts = [p for p in name.split("/") if p not in ("", ".")]
    return bool(parts) and ".." not in parts


def normalize_archive_path(name: str) -> str:
    return "/".join(p for p in name.split("/") if p not in ("", "."))


def documents_without_files(storage_keys: Iterable[str], archived_paths: Iterable[str], prefix: str) -> List[str]:
    """DB が参照している保存ファイル(storage_key)のうち、アーカイブに無いもの。

    ``prefix`` は uploads 直下からの保存先(例: ``documents``)。返すのは件数の確認用で、
    呼び出し側は件数だけを文面に出す(storage_key 自体は旅行IDを含むため出さない)。
    """
    have = set(normalize_archive_path(p) for p in archived_paths)
    out = []
    for key in storage_keys:
        rel = normalize_archive_path((prefix.strip("/") + "/" + key) if prefix else key)
        if rel not in have:
            out.append(key)
    return sorted(out)


# ---------------------------------------------------------------------------
# migration の rollback 計画
# ---------------------------------------------------------------------------

_REV_RE = re.compile(r"^revision(?:\s*:\s*str)?\s*=\s*['\"]([0-9a-zA-Z_]+)['\"]", re.M)
_DOWN_RE = re.compile(r"^down_revision(?:\s*:\s*[^=]+)?\s*=\s*(.+)$", re.M)


def parse_migration_source(source: str) -> Tuple[str, Tuple[str, ...]]:
    """alembic の revision ファイルから (revision, down_revisions) を取り出す。"""
    m = _REV_RE.search(source)
    if not m:
        raise ValueError("revision が見つかりません")
    d = _DOWN_RE.search(source)
    downs: Tuple[str, ...] = ()
    if d:
        downs = tuple(re.findall(r"['\"]([0-9a-zA-Z_]+)['\"]", d.group(1)))
    return m.group(1), downs


def migration_heads(graph: Mapping[str, Sequence[str]]) -> List[str]:
    """どの revision からも down として参照されていない revision(= head)。"""
    referenced = set()
    for downs in graph.values():
        referenced.update(downs)
    return sorted(r for r in graph if r not in referenced)


def ancestors(graph: Mapping[str, Sequence[str]], rev: str) -> Set[str]:
    out: Set[str] = set()
    stack = [rev]
    while stack:
        cur = stack.pop()
        if cur in out or cur not in graph:
            continue
        out.add(cur)
        stack.extend(graph[cur])
    return out


def rollback_plan(current: Mapping[str, Sequence[str]], target: Mapping[str, Sequence[str]]) -> Dict[str, object]:
    """今の版から過去の版へコードを戻す時に、先に downgrade が要る migration を求める。

    - ``current`` / ``target``: それぞれの版の revision → down_revisions
    - 戻り値 ``downgrade_to``: ``alembic downgrade <rev>`` に渡す revision(不要なら None)
    - ``steps``: 取り消される revision(新しい順)
    - ``ok`` が False の時は、target の head が今の履歴に無い(枝分かれ)ので自動では戻せない
    """
    cur_heads = migration_heads(current)
    tgt_heads = migration_heads(target)
    if len(cur_heads) != 1 or len(tgt_heads) != 1:
        return {
            "ok": False,
            "reason": "head が1つではありません",
            "current_head": cur_heads,
            "target_head": tgt_heads,
            "downgrade_to": None,
            "steps": [],
        }
    cur_head, tgt_head = cur_heads[0], tgt_heads[0]
    cur_anc = ancestors(current, cur_head)
    if tgt_head not in cur_anc:
        return {
            "ok": False,
            "reason": "戻し先の migration が今の履歴にありません",
            "current_head": cur_head,
            "target_head": tgt_head,
            "downgrade_to": None,
            "steps": [],
        }
    removed = cur_anc - ancestors(current, tgt_head)
    # 新しい順に並べる(head から辿った順)
    order: List[str] = []
    rev: Optional[str] = cur_head
    while rev and rev in removed:
        order.append(rev)
        downs = list(current.get(rev, ()))
        rev = downs[0] if len(downs) == 1 else None
    if len(order) != len(removed):
        order = sorted(removed)
    return {
        "ok": True,
        "reason": None,
        "current_head": cur_head,
        "target_head": tgt_head,
        "downgrade_to": tgt_head if removed else None,
        "steps": order,
    }


# ---------------------------------------------------------------------------
# 監視
# ---------------------------------------------------------------------------

# ラベルの値は引用符で囲まれ、ルートの型の "{plan_id}" のように { } を含むことがある
_PROM_LINE_RE = re.compile(
    r'^(?P<name>[a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(?P<labels>(?:[^"}]|"(?:[^"\\]|\\.)*")*)\})?\s+(?P<value>\S+)'
)
_PROM_LABEL_RE = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"')

MetricKey = Tuple[str, Tuple[Tuple[str, str], ...]]


def parse_prometheus(text: str) -> Dict[MetricKey, float]:
    out: Dict[MetricKey, float] = {}
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = _PROM_LINE_RE.match(line)
        if not m:
            continue
        labels = tuple(sorted(_PROM_LABEL_RE.findall(m.group("labels") or "")))
        try:
            value = float(m.group("value"))
        except ValueError:
            continue
        out[(m.group("name"), labels)] = value
    return out


def metric_sum(metrics: Mapping[MetricKey, float], name: str, **match: str) -> float:
    total = 0.0
    for (n, labels), v in metrics.items():
        if n != name:
            continue
        ld = dict(labels)
        if all(ld.get(k) == val for k, val in match.items()):
            total += v
    return total


def counter_delta(current: float, previous: Optional[float]) -> float:
    """累積カウンタの増分。プロセス再起動で減った時は current を増分とみなす。"""
    if previous is None:
        return 0.0
    if current < previous:
        return current
    return current - previous


def histogram_buckets(metrics: Mapping[MetricKey, float], name: str) -> Dict[float, float]:
    """``<name>_bucket`` を全ラベルについて合算し、上限(le) → 累積件数 にする。"""
    buckets: Dict[float, float] = {}
    for (n, labels), v in metrics.items():
        if n != name + "_bucket":
            continue
        le = dict(labels).get("le")
        if le is None:
            continue
        bound = math.inf if le in ("+Inf", "Inf") else float(le)
        buckets[bound] = buckets.get(bound, 0.0) + v
    return buckets


def histogram_quantile(buckets: Mapping[float, float], q: float) -> Optional[float]:
    """累積バケットからの分位点の推定(バケット内は線形補間)。件数0なら None。"""
    if not buckets:
        return None
    items = sorted(buckets.items())
    total = items[-1][1]
    if total <= 0:
        return None
    rank = q * total
    prev_bound, prev_count = 0.0, 0.0
    for bound, count in items:
        if count >= rank:
            if math.isinf(bound):
                return prev_bound
            span = count - prev_count
            if span <= 0:
                return bound
            return prev_bound + (bound - prev_bound) * (rank - prev_count) / span
        prev_bound, prev_count = (0.0 if math.isinf(bound) else bound), count
    return prev_bound


def subtract_buckets(current: Mapping[float, float], previous: Optional[Mapping[float, float]]) -> Dict[float, float]:
    if not previous:
        return {}
    if any(current.get(b, 0.0) < v for b, v in previous.items()):
        return dict(current)  # 再起動
    return {b: current.get(b, 0.0) - previous.get(b, 0.0) for b in current}


DEFAULT_THRESHOLDS = {
    "http_5xx_count": 5,
    "http_5xx_ratio": 0.05,
    "min_requests_for_ratio": 20,
    "p95_seconds": 2.0,
    "disk_free_bytes": 2 * 1024**3,
    "disk_free_ratio": 0.10,
    "backup_max_age_hours": 26,
    "drill_max_age_days": 8,
    # [Gate S6] SEC-18 前回の確認からの、セキュリティの出来事(拒否・検出)の件数
    "security_events_count": 50,
    # [Gate S10] 前回の確認からの、ブラウザからの CSP 違反の報告の件数
    "csp_violations_count": 20,
}


def evaluate_monitor(
    snapshot: Mapping[str, object],
    previous: Optional[Mapping[str, object]],
    thresholds: Optional[Mapping[str, float]] = None,
) -> List[Dict[str, str]]:
    """監視の1回分の観測(snapshot)から、注意・異常を判定する。

    snapshot のキー(無いものは判定しない):
      health_ok(bool), ready(dict: name→bool または None=取得不能), containers(dict: name→状態文字列),
      http_requests_total, http_5xx_total(float), latency_buckets(dict le→累積),
      disk_free_bytes, disk_total_bytes, last_backup_age_hours(None=無い), last_drill_age_days(None=無い)
    previous: 前回の snapshot(増分の計算に使う)。
    戻り値: [{"level": "critical"|"warning", "code": ..., "message": ...}]
    """
    th = dict(DEFAULT_THRESHOLDS)
    th.update(thresholds or {})
    out: List[Dict[str, str]] = []

    def add(level: str, code: str, message: str) -> None:
        out.append({"level": level, "code": code, "message": message})

    if snapshot.get("health_ok") is False:
        add("critical", "backend_down", "backend が /health に応答しません")
    ready = snapshot.get("ready")
    if ready is None and snapshot.get("health_ok") is not False and "ready" in snapshot:
        add("critical", "backend_not_ready", "backend の /ready を取得できません")
    elif isinstance(ready, dict):
        failing = sorted(k for k, v in ready.items() if v is False)
        if failing:
            add("critical", "backend_not_ready", "準備ができていない項目: " + ", ".join(failing))
    containers = snapshot.get("containers")
    if isinstance(containers, dict):
        bad = sorted(k for k, v in containers.items() if v not in ("healthy", "running"))
        if bad:
            add("critical", "container_unhealthy", "正常でないコンテナ: " + ", ".join(bad))

    prev = previous or {}
    if "http_requests_total" in snapshot and "http_5xx_total" in snapshot and prev:
        req = counter_delta(float(snapshot["http_requests_total"]), _num(prev.get("http_requests_total")))
        err = counter_delta(float(snapshot["http_5xx_total"]), _num(prev.get("http_5xx_total")))
        if err >= th["http_5xx_count"] or (
            req >= th["min_requests_for_ratio"] and req > 0 and err / req >= th["http_5xx_ratio"]
        ):
            add("warning", "http_5xx", "前回の確認から 5xx が %d 件(リクエスト %d 件)" % (err, req))
        cur_b = snapshot.get("latency_buckets")
        prev_b = prev.get("latency_buckets")
        if isinstance(cur_b, dict) and isinstance(prev_b, dict) and req >= th["min_requests_for_ratio"]:
            delta = subtract_buckets(_float_keys(cur_b), _float_keys(prev_b))
            p95 = histogram_quantile(delta, 0.95)
            if p95 is not None and p95 > th["p95_seconds"]:
                add("warning", "slow_responses", "応答時間の95%%点が約%.1f秒です" % p95)

    # [Gate S6] SEC-18 攻撃の兆候(自動遮断・拒否の急増・監査の書き込み失敗)を通知する
    if prev:
        blocks = counter_delta(_num(snapshot.get("guard_blocks_total")) or 0.0, _num(prev.get("guard_blocks_total")))
        if "guard_blocks_total" in snapshot and blocks >= 1:
            add("warning", "guard_blocked", "前回の確認から、不審な接続元を %d 件自動で遮断しました(Runbook §3.9)" % blocks)
        events = counter_delta(
            _num(snapshot.get("security_events_total")) or 0.0, _num(prev.get("security_events_total")))
        if "security_events_total" in snapshot and events >= th["security_events_count"]:
            add("warning", "security_events_spike",
                "前回の確認から、セキュリティの拒否・検出が %d 件ありました(攻撃の可能性。Runbook §3.9)" % events)
        audit = counter_delta(
            _num(snapshot.get("audit_write_failed_total")) or 0.0, _num(prev.get("audit_write_failed_total")))
        csp = counter_delta(
            _num(snapshot.get("csp_violations_total")) or 0.0, _num(prev.get("csp_violations_total")))
        if "csp_violations_total" in snapshot and csp >= th["csp_violations_count"]:
            add("warning", "csp_violations",
                "前回の確認から、画面の CSP 違反の報告が %d 件ありました(スクリプトの差し込み・画面の不具合の可能性。"
                "Runbook §3.11)" % csp)
        if "audit_write_failed_total" in snapshot and audit >= 1:
            add("critical", "audit_write_failed", "監査ログの書き込みに %d 回失敗しました(記録が欠けています)" % audit)

    free = _num(snapshot.get("disk_free_bytes"))
    total = _num(snapshot.get("disk_total_bytes"))
    if free is not None:
        low = free < th["disk_free_bytes"] or (total and total > 0 and free / total < th["disk_free_ratio"])
        if low:
            add("warning", "disk_low", "バックアップ先の空き容量が少なくなっています(残り約%.1fGB)" % (free / 1024**3))

    if "last_backup_age_hours" in snapshot:
        age = snapshot.get("last_backup_age_hours")
        if age is None:
            add("critical", "backup_missing", "検証済みのバックアップがありません")
        elif float(age) > th["backup_max_age_hours"]:
            add("warning", "backup_stale", "最後のバックアップから約%d時間経っています" % float(age))
    if "log_leaks" in snapshot:
        leaks = snapshot.get("log_leaks")
        if leaks:
            add("warning", "log_leak", "直近のログ検査で個人情報・秘密らしき値が %d 件見つかりました(log-scan)" % int(leaks))
    if "last_drill_age_days" in snapshot:
        age = snapshot.get("last_drill_age_days")
        if age is None:
            add("warning", "restore_drill_missing", "復元演習の記録がありません")
        elif float(age) > th["drill_max_age_days"]:
            add("warning", "restore_drill_stale", "最後の復元演習から約%d日経っています" % float(age))
    # [Gate G8] FR-004 定期の処理の記録(app/ops/job_runs.py の status)。一度も動いていない処理(never)は判定しない
    jobs = snapshot.get("jobs")
    if isinstance(jobs, list):
        for j in jobs:
            if not isinstance(j, dict):
                continue
            name = str(j.get("job"))
            if j.get("state") == "overdue":
                mins = j.get("minutes_since_success")
                add("warning", "job_overdue:" + name, "定期の処理 %s の最後の成功から %s 分経っています(定期実行が止まった"
                    "・失敗が続いている)" % (name, "不明" if mins is None else int(mins)))
            elif j.get("state") == "failing":
                add("warning", "job_failing:" + name, "定期の処理 %s が %d 回続けて失敗しています"
                    % (name, int(j.get("consecutive_failures") or 1)))
    return out


def _num(v: object) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _float_keys(d: Mapping[object, object]) -> Dict[float, float]:
    out: Dict[float, float] = {}
    for k, v in d.items():
        key = math.inf if str(k) in ("inf", "+Inf", "Inf") else float(k)  # type: ignore[arg-type]
        out[key] = float(v)  # type: ignore[arg-type]
    return out


def alert_transitions(previous_active: Iterable[str], findings: Sequence[Mapping[str, str]]) -> Dict[str, List[str]]:
    """通知を、状態が変わった時だけ送るための差分(同じ異常を5分ごとに送り続けない)。"""
    prev = set(previous_active)
    cur = set(f["code"] for f in findings)
    return {"raised": sorted(cur - prev), "resolved": sorted(prev - cur), "active": sorted(cur)}


# ---------------------------------------------------------------------------
# 定期実行(cron)
# ---------------------------------------------------------------------------

CRON_BEGIN = "# >>> travelcanvas ops (scripts/ops/tcops.py が管理) >>>"
CRON_END = "# <<< travelcanvas ops <<<"


def render_cron_block(repo_dir: str, python: str = "/usr/bin/python3", log_dir: Optional[str] = None) -> str:
    """定期実行の設定(crontab の1区画)。時刻はホストの時刻(omega-dev2 は JST)。"""
    if not repo_dir.startswith("/") or any(c in repo_dir for c in " '\"$`\\\n"):
        raise ValueError("repo_dir は空白・引用符を含まない絶対パスにしてください")
    if not python.startswith("/") or any(c in python for c in " '\"$`\\\n"):
        raise ValueError("python は絶対パスにしてください")
    log = (log_dir or repo_dir + "/ops-state/logs").rstrip("/")
    tool = "%s %s/scripts/ops/tcops.py" % (python, repo_dir)
    lines = [
        CRON_BEGIN,
        "# 毎日 03:10 バックアップ(DB+保存ファイル)→検証→古い世代の整理",
        "10 3 * * * cd %s && %s backup --prune >> %s/backup.log 2>&1" % (repo_dir, tool, log),
        "# 毎日 03:40 猶予期間を過ぎた削除済みデータの完全削除(旅行・文書・QuickDraft)",
        "40 3 * * * cd %s && %s purge >> %s/purge.log 2>&1" % (repo_dir, tool, log),
        "# [Gate G3] 毎日 03:45 破棄したデータ鍵を全ての世代のバックアップの鍵の写しから消す(鍵の破棄による削除)",
        "45 3 * * * cd %s && %s keys purge-escrow >> %s/purge.log 2>&1" % (repo_dir, tool, log),
        "# 毎週日曜 04:20 最新バックアップの復元演習(別DBへ復元して件数・復号・migrationの往復を確認)",
        "20 4 * * 0 cd %s && %s drill --from-latest >> %s/drill.log 2>&1" % (repo_dir, tool, log),
        "# 毎日 03:50 直近25時間の backend のログに個人情報・秘密が出ていないかの検査(B-009)",
        "50 3 * * * cd %s && %s log-scan --since 25h >> %s/log-scan.log 2>&1" % (repo_dir, tool, log),
        "# [Gate G2] 5分ごと Webhook の失敗した送信の自動の再送(上限に達したら dead)",
        "*/5 * * * * cd %s && %s jobs webhook-retry >> %s/webhook-retry.log 2>&1" % (repo_dir, tool, log),
        "# [Gate G4] 15分ごと 投票の締切(締切前の知らせ・締め)",
        "*/15 * * * * cd %s && %s jobs poll-deadlines >> %s/jobs.log 2>&1" % (repo_dir, tool, log),
        "# [Gate G4] 5分ごと 通知のまとめのメールと送信待ちのメール(送信の設定が無ければ何もしない)",
        "*/5 * * * * cd %s && %s jobs email-outbox >> %s/jobs.log 2>&1" % (repo_dir, tool, log),
        "# [Gate G4] 毎時 25分 濫用の自動の検知(大量の閲覧・合言葉の総当たり・共有の乱造・感染した文書)",
        "25 * * * * cd %s && %s jobs abuse-scan >> %s/jobs.log 2>&1" % (repo_dir, tool, log),
        "# [Gate G6] 毎日 04:05 削除してから7日を過ぎた記録(写真・音声のファイルを含む)を消す",
        "5 4 * * * cd %s && %s jobs memory-trash >> %s/jobs.log 2>&1" % (repo_dir, tool, log),
        "# [Gate G7] 毎日 04:20 猶予(既定14日)を過ぎたアカウントの削除の申し込みを削除する",
        "20 4 * * * cd %s && %s jobs account-deletions >> %s/jobs.log 2>&1" % (repo_dir, tool, log),
        "# 5分ごとの監視(状態が変わった時だけ通知)",
        "*/5 * * * * cd %s && %s monitor --quiet >> %s/monitor.log 2>&1" % (repo_dir, tool, log),
        CRON_END,
    ]
    return "\n".join(lines) + "\n"


def merge_cron(existing: str, block: Optional[str]) -> str:
    """既存の crontab に管理区画を入れる/置き換える(block=None なら取り除く)。他の行は変えない。"""
    text = existing or ""
    out_lines: List[str] = []
    inside = False
    for line in text.splitlines():
        if line.strip() == CRON_BEGIN:
            inside = True
            continue
        if line.strip() == CRON_END:
            inside = False
            continue
        if not inside:
            out_lines.append(line)
    if inside:
        raise ValueError("crontab の管理区画の終わりがありません。手で確認してください")
    while out_lines and not out_lines[-1].strip():
        out_lines.pop()
    body = "\n".join(out_lines)
    if body:
        body += "\n"
    if block:
        if body:
            body += "\n"
        body += block if block.endswith("\n") else block + "\n"
    return body


# ---------------------------------------------------------------------------
# 演習の報告書
# ---------------------------------------------------------------------------


def render_drill_report(result: Mapping[str, object]) -> str:
    """復元・rollback 演習の結果を Markdown にする。DB名・件数・ハッシュ・所要時間だけを書き、
    個人データ・storage_key・接続文字列は書かない。"""

    def yn(v: object) -> str:
        return "合格" if v else "不合格"

    backup = result.get("backup") or {}
    restore = result.get("restore") or {}
    counts = restore.get("counts") or {}
    files = restore.get("files") or {}
    decrypt = restore.get("decrypt") or {}
    mig = result.get("migration_roundtrip") or {}
    plan = result.get("rollback_plan") or {}
    monitor = result.get("monitor") or {}
    lines = [
        "# 復元・rollback 演習記録 %s" % result.get("drill_id", ""),
        "",
        "> `scripts/ops/tcops.py drill` が自動生成した記録です。個人データ・接続文字列・保存ファイルの名前は含めていません。",
        "",
        "## 結果",
        "",
        "| 項目 | 結果 |",
        "|---|---|",
        "| 総合判定 | **%s** |" % yn(result.get("ok")),
        "| 実行日時(UTC) | %s |" % result.get("started_at", ""),
        "| 実行環境 | %s |" % result.get("environment", ""),
        "| 実行時のHEAD | `%s`(未commitの変更を含むことがある) |" % (result.get("git_commit") or "-"),
        "| 所要時間 | %s 秒 |" % result.get("duration_seconds", "-"),
        "",
        "## 1. バックアップ",
        "",
        "| 項目 | 値 |",
        "|---|---|",
        "| バックアップID | `%s` |" % backup.get("backup_id", "-"),
        "| 元DB | `%s`(alembic `%s`) |" % (backup.get("source_database", "-"), backup.get("alembic_revision", "-")),
        "| DBダンプ | %s バイト、sha256 `%s` |"
        % (backup.get("database_size", "-"), str(backup.get("database_sha256", "-"))[:16] + "…"),
        "| 保存ファイル | %s 件、アーカイブ %s バイト |" % (backup.get("upload_count", "-"), backup.get("uploads_size", "-")),
        "| manifest との照合 | %s |" % yn(backup.get("verified")),
        "",
        "## 2. 別DBへの復元(運用中のDBには触れない)",
        "",
        "| 項目 | 結果 |",
        "|---|---|",
        "| 復元先 | `%s` |" % restore.get("target_database", "-"),
        "| pg_restore | %s |" % yn(restore.get("restored")),
        "| alembic の版 | %s(復元先 `%s`) |" % (yn(restore.get("alembic_match")), restore.get("alembic_revision", "-")),
        "| 表ごとの件数 | %s(%s 表・%s 行、一致 %s、運用中に変化 %s、不一致 %s、欠落 %s) |"
        % (
            yn(counts.get("ok")),
            counts.get("tables", "-"),
            counts.get("rows", "-"),
            len(counts.get("matched") or []),
            len(counts.get("unstable") or []),
            len(counts.get("mismatched") or []),
            len(counts.get("missing") or []),
        ),
        "| 保存ファイル | %s(%s 件、欠落 %s、内容違い %s、DBが参照するのに無いファイル %s 件) |"
        % (
            yn(files.get("ok")),
            files.get("files", "-"),
            len(files.get("missing") or []),
            len(files.get("changed") or []),
            files.get("documents_without_files", "-"),
        ),
        "| 暗号化列の復号(今の鍵で) | %s(%s 列を確認、成功 %s、失敗 %s) |"
        % (
            yn(decrypt.get("ok")),
            decrypt.get("columns", "-"),
            decrypt.get("decrypted", "-"),
            decrypt.get("failed", "-"),
        ),
        "| 鍵の指紋の一致 | %s |"
        % (
            "一致"
            if not restore.get("fingerprint_mismatches")
            else "不一致: " + ", ".join(restore.get("fingerprint_mismatches") or [])
        ),
        "",
        "## 3. migration の rollback 演習(復元先DBで実施)",
        "",
        "| 項目 | 結果 |",
        "|---|---|",
        "| downgrade -1 → upgrade head | %s |" % yn(mig.get("ok")),
        "| 戻した revision | `%s` → `%s` → `%s` |"
        % (mig.get("from", "-"), mig.get("downgraded_to", "-"), mig.get("upgraded_to", "-")),
        "| 往復後の表の数 | %s(往復前 %s) |" % (mig.get("tables_after", "-"), mig.get("tables_before", "-")),
        "",
        "## 4. コードの rollback 計画(1つ前の commit へ戻す場合)",
        "",
        "| 項目 | 結果 |",
        "|---|---|",
        "| 戻し先 | `%s` |" % (plan.get("target") or "-"),
        "| 自動で戻せるか | %s |" % ("はい" if plan.get("ok") else "いいえ(%s)" % plan.get("reason")),
        "| 先に必要な downgrade | %s |"
        % (
            ("`alembic downgrade %s`(%d 件)" % (plan.get("downgrade_to"), len(plan.get("steps") or [])))
            if plan.get("downgrade_to")
            else "不要(migrationの変更なし)"
        ),
        "",
        "## 5. 監視の確認",
        "",
        "| 項目 | 結果 |",
        "|---|---|",
        "| /health・/ready・/metrics | %s |" % yn(monitor.get("ok")),
        "| 検出 | %s |"
        % (
            "なし"
            if not monitor.get("findings")
            else "、".join("%s(%s)" % (f.get("code"), f.get("level")) for f in monitor.get("findings") or [])
        ),
        "",
    ]
    if result.get("errors"):
        lines += ["## 失敗の内容", ""] + ["- %s" % mask_url(str(e)) for e in result.get("errors") or []] + [""]
    return "\n".join(lines)


def dumps_json(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True, default=str)


# ---------------------------------------------------------------------------
# [Gate G3] SEC-F5 データ鍵の写し(<ID>.keys.jsonl)から、破棄した鍵の中身を消す(標準ライブラリだけ)
# ---------------------------------------------------------------------------


def purge_escrow_lines(lines: Iterable[str], destroyed: Iterable[str]) -> Tuple[List[str], int]:
    """戻り値: (書き直した行, 消した鍵の数)。破棄した鍵は {"wrapped": null, "destroyed": true} の記録だけにする。"""
    import uuid as _uuid

    gone = {str(_uuid.UUID(str(i))) for i in destroyed}
    out: List[str] = []
    removed = 0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        obj = json.loads(line)
        if str(_uuid.UUID(str(obj["id"]))) in gone and not obj.get("destroyed"):
            obj = dict(obj, wrapped=None, destroyed=True)
            removed += 1
        out.append(json.dumps(obj, ensure_ascii=False, sort_keys=True))
    return out, removed
