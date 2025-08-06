"""
Travel API endpoints
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Travel

router = APIRouter()

@router.get("/")
async def get_travels(
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's travel plans"""
    travels = db.query(Travel).filter(
        Travel.owner_id == current_user.id
    ).offset(skip).limit(limit).all()
    
    return {"travels": travels, "total": len(travels)}

@router.post("/")
async def create_travel(
    title: str,
    description: str = "",
    location: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new travel plan"""
    travel = Travel(
        title=title,
        description=description,
        location=location,
        owner_id=current_user.id
    )
    
    db.add(travel)
    db.commit()
    db.refresh(travel)
    
    return travel
