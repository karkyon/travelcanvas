"""[Gate S8] 侵害が疑われる時の封じ込め(backend のコンテナの中で実行する)。

ホストからは ``python3 scripts/ops/tcops.py security <操作>`` で呼ぶ(Runbook §9)。

    status                                  警戒モード・遮断中の接続元の数・回数制限の状態
    lockdown on --minutes 60 [--close-signup] [--reason "…"]
    lockdown off
    unblock --ip 203.0.113.5                その接続元の点数・遮断を消す
    unblock-all                             全ての接続元の点数・遮断を消す
    revoke-sessions --email user@example.com [--reason "…"]
    revoke-sessions --all --yes [--reason "…"]   全員の全端末をログアウトさせる
    mfa-status --email admin@example.com    [Gate S11] 多要素認証の設定の有無(回復コードの残り数)
    mfa-reset-request --email user@example.com --requested-by admin-a@example.com --reason "…"
                                            [Gate G3] SEC-F6 端末と回復コードを両方なくした人の多要素認証の解除を申請する
                                            (本人確認は運用者が別の手段で行い、方法を理由に書く。24時間で期限切れ)
    mfa-reset --request <申請のID> --approved-by admin-b@example.com --yes
                                            [Gate G3] 申請した人とは別の管理者が承認して解除する(その人の全端末をログアウト、
                                            本人へ知らせる)。対象の本人は申請も承認もできない
    grant-admin --email a@example.com --yes [--reason "…"]
                                            [Gate A2] 管理者の権限を付ける(その人の全端末をログアウト。次に管理者の画面を
                                            開く時に多要素認証の設定を求める)
    revoke-admin --email a@example.com --yes [--reason "…"]
                                            [Gate A2] 管理者の権限を外す(その人の全端末をログアウト)

結果は1行の JSON(値に個人情報を含めない)。終了コード: 0=成功、2=使い方の誤り、3=失敗、4=効果が無い(共有できない)
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import SessionLocal  # noqa: E402
from app.services import incident, threat_guard  # noqa: E402
from app.utils import rate_limiter  # noqa: E402

EXIT_OK, EXIT_USAGE, EXIT_FAIL, EXIT_NO_EFFECT = 0, 2, 3, 4


def _print(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, sort_keys=True))


def _blocked_count() -> int:
    if not rate_limiter._redis_available():
        return -1
    try:
        client = rate_limiter._client()
        return sum(1 for _ in client.scan_iter(match=f"{rate_limiter.namespace()}:guard:b:*", count=500))
    except Exception:  # noqa: BLE001
        return -1


def _shared() -> bool:
    try:
        rate_limiter._client().ping()
        return True
    except Exception:  # noqa: BLE001
        return False


def _mfa_command(args) -> int:
    """[Gate S11] 多要素認証の確認・解除(値に個人情報を含めない)。"""
    from app.models.models import User, UserMfa

    if args.cmd == "mfa-reset" and not args.yes:
        _print({"ok": False, "error": "多要素認証を外すには --yes も付けてください"})
        return EXIT_USAGE
    if args.cmd in ("mfa-reset", "mfa-reset-request"):
        # [Gate G3] SEC-F6 申請と承認(二者の確認)。以前の「--email だけで外す」は使えない
        from app.services import mfa_reset

        if args.cmd == "mfa-reset" and not (args.request and args.approved_by):
            _print({"ok": False, "error": "先に mfa-reset-request で申請し、別の管理者が --request <ID> --approved-by で承認してください"})
            return EXIT_USAGE
        db = SessionLocal()
        try:
            if args.cmd == "mfa-reset-request":
                _print(mfa_reset.request_reset(db, target_email=args.email, requested_by=args.requested_by,
                                               reason=args.reason))
            else:
                _print(mfa_reset.approve_reset(db, request_id=args.request, approved_by=args.approved_by))
            return EXIT_OK
        except mfa_reset.MfaResetError as e:
            _print({"ok": False, "error": str(e)})
            return EXIT_FAIL
        finally:
            db.close()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == args.email).first()
        if user is None:
            _print({"ok": False, "error": "その利用者は見つかりません"})
            return EXIT_FAIL
        rec = db.query(UserMfa).filter(UserMfa.user_id == user.id).first()
        if args.cmd == "mfa-status":
            _print({"ok": True, "enabled": bool(rec and rec.confirmed_at),
                    "pending": bool(rec and not rec.confirmed_at),
                    "recovery_codes_remaining": len(rec.recovery_code_hashes or []) if rec else 0})
            return EXIT_OK
        return EXIT_USAGE
    finally:
        db.close()


def _admin_command(args) -> int:
    """[Gate A2] 管理者の権限の付与・取り消し(app/services/admin_roles.py)。"""
    from app.services import admin_roles

    if not args.yes:
        _print({"ok": False, "error": "管理者の権限を変えるには --yes も付けてください"})
        return EXIT_USAGE
    db = SessionLocal()
    try:
        fn = admin_roles.grant_admin if args.cmd == "grant-admin" else admin_roles.revoke_admin
        _print(fn(db, args.email, args.reason))
        return EXIT_OK
    except admin_roles.AdminRoleError as e:
        _print({"ok": False, "error": str(e)})
        return EXIT_FAIL
    finally:
        db.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="侵害が疑われる時の封じ込め(Runbook §9)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    p = sub.add_parser("lockdown")
    p.add_argument("action", choices=("on", "off"))
    p.add_argument("--minutes", type=int, default=60)
    p.add_argument("--close-signup", action="store_true")
    p.add_argument("--reason", default="")
    p = sub.add_parser("unblock")
    p.add_argument("--ip", required=True)
    sub.add_parser("unblock-all")
    p = sub.add_parser("revoke-sessions")
    p.add_argument("--email")
    p.add_argument("--all", action="store_true")
    p.add_argument("--yes", action="store_true", help="--all の確認")
    p.add_argument("--reason", default="")
    p = sub.add_parser("mfa-status")
    p.add_argument("--email", required=True)
    p = sub.add_parser("mfa-reset-request")
    p.add_argument("--email", required=True, help="解除する人")
    p.add_argument("--requested-by", required=True, help="申請する管理者")
    p.add_argument("--reason", required=True, help="理由(本人確認の方法を含む)")
    p = sub.add_parser("mfa-reset")
    p.add_argument("--request", help="申請の ID(mfa-reset-request の結果)")
    p.add_argument("--approved-by", help="承認する管理者(申請した人とは別)")
    p.add_argument("--email", help="(使えません。以前の形)")
    p.add_argument("--yes", action="store_true", help="外すことの確認")
    p.add_argument("--reason", default="")
    for name in ("grant-admin", "revoke-admin"):
        p = sub.add_parser(name)
        p.add_argument("--email", required=True)
        p.add_argument("--yes", action="store_true", help="権限を変えることの確認")
        p.add_argument("--reason", default="")
    args = parser.parse_args(argv)

    if args.cmd in ("mfa-status", "mfa-reset", "mfa-reset-request"):
        return _mfa_command(args)
    if args.cmd in ("grant-admin", "revoke-admin"):
        return _admin_command(args)

    rate_limiter.use_backend("auto")
    shared = _shared()

    if args.cmd == "status":
        state = incident.lockdown_state(fresh=True)
        _print({
            "redis_shared": shared,
            "lockdown": bool(state),
            "lockdown_until": state.get("until") if state else None,
            "close_signup": bool(state and state.get("close_signup")),
            "blocked_clients": _blocked_count(),
            "guard_enabled": bool(threat_guard._enabled()),
        })
        return EXIT_OK

    if args.cmd == "lockdown":
        if not shared:
            _print({"ok": False, "error": "Redis に届かないため、backend の全プロセスに伝えられません(Runbook §3.7)"})
            return EXIT_NO_EFFECT
        if args.action == "on":
            state = incident.set_lockdown(args.minutes, close_signup=args.close_signup, reason=args.reason)
            _print({"ok": True, "lockdown": True, "until": state["until"], "close_signup": state["close_signup"]})
        else:
            incident.clear_lockdown()
            _print({"ok": True, "lockdown": False})
        return EXIT_OK

    if args.cmd == "unblock":
        threat_guard.reset(args.ip)
        _print({"ok": True, "unblocked": 1, "shared": shared})
        return EXIT_OK if shared else EXIT_NO_EFFECT

    if args.cmd == "unblock-all":
        removed = threat_guard.reset_all()
        _print({"ok": True, "removed_keys": removed, "shared": shared})
        return EXIT_OK if shared else EXIT_NO_EFFECT

    if args.cmd == "revoke-sessions":
        if bool(args.email) == bool(args.all):
            _print({"ok": False, "error": "--email か --all のどちらか一方を指定してください"})
            return EXIT_USAGE
        if args.all and not args.yes:
            _print({"ok": False, "error": "全員をログアウトさせるには --yes も付けてください"})
            return EXIT_USAGE
        db = SessionLocal()
        try:
            count = incident.revoke_sessions(db, email=args.email, all_users=args.all, reason=args.reason)
        except LookupError as error:
            _print({"ok": False, "error": str(error)})
            return EXIT_FAIL
        finally:
            db.close()
        _print({"ok": True, "revoked_sessions": count, "scope": "all" if args.all else "user"})
        return EXIT_OK
    return EXIT_USAGE


if __name__ == "__main__":
    sys.exit(main())
