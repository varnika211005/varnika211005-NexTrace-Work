from sqlalchemy.orm import Session
from . import models
from .auth import hash_password

DEFAULT_USERS = [
    {
        "analyst_id": "INV204",
        "name": "Priya Singh",
        "password": "investigator123",
        "role": "investigator",
    },
    {
        "analyst_id": "ADMIN01",
        "name": "Vikram Nair",
        "password": "admin123",
        "role": "admin_investigator",
    },
]


def seed_users(db: Session):
    for u in DEFAULT_USERS:
        existing = db.query(models.User).filter(models.User.analyst_id == u["analyst_id"]).first()
        if not existing:
            db.add(models.User(
                analyst_id=u["analyst_id"],
                name=u["name"],
                password_hash=hash_password(u["password"]),
                role=u["role"],
                status="Active",
            ))
    db.commit()
