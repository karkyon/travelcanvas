"""
Admin API endpoints
"""

from fastapi import APIRouter, Depends
from app.core.security import get_current_user
from app.models.models import User

router = APIRouter()

@router.get("/stats")
async def get_admin_stats(
    current_user: User = Depends(get_current_user)
):
    """Get admin statistics"""
    return {
        "total_users": 150,
        "total_travels": 432,
        "optimized_routes": 298
    }
