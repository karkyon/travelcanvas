"""[Gate G5] BILL-02 自分の今月の使用量と上限(app/services/usage.py)。会員だけ(ゲストは 401)。"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_active_user
from app.core.database import get_db
from app.models.models import User
from app.services import usage

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("")
async def my_usage(user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    return usage.summary(db, "user", user.id)
