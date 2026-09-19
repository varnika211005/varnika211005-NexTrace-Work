import hashlib
import os
import time
import jwt
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from .database import get_db
from . import models

SECRET_KEY = os.environ.get("NEXTRACE_SECRET", "nextrace-demo-secret-do-not-use-in-production")
ALGORITHM = "HS256"
TOKEN_TTL_SECONDS = 60 * 60 * 12  # 12 hours


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    return hash_password(password) == password_hash


def create_token(user: models.User) -> str:
    payload = {
        "sub": user.analyst_id,
        "role": user.role,
        "name": user.name,
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid authentication token.")


def get_current_user(
    authorization: str = Header(None), db: Session = Depends(get_db)
) -> models.User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated.")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    user = db.query(models.User).filter(models.User.analyst_id == payload["sub"]).first()
    if not user:
        raise HTTPException(401, "User no longer exists.")
    # Same admin exception as login: an Admin Investigator is never locked out, even if marked
    # Inactive. An Investigator's session is cut off immediately once deactivated, not just
    # blocked from future logins - so this check also applies here, not only at /auth/login.
    if user.status != "Active" and user.role != "admin_investigator":
        raise HTTPException(403, "This account has been deactivated. Contact an administrator.")
    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if user.role != "admin_investigator":
        raise HTTPException(403, "Administrative permission required.")
    return user


def authenticate_with_passkey(db: Session, analyst_id: str, credential_response: dict) -> models.User:
    """Extension point: exchange a verified WebAuthn/passkey (device biometric) assertion for
    an analyst session. Delegates to the WebAuthn backend registered in webauthn_auth_registry
    and NEVER reports success when no real relying party is configured. Password + JWT login
    remains the working path; no biometric template is stored."""
    from . import webauthn_auth
    backend = webauthn_auth.get_webauthn_backend()
    if not backend.configured:
        raise HTTPException(501, "Biometric/passkey authentication is not configured on this "
                                 "deployment. Sign in with your Analyst ID and password.")
    if not backend.verify_authentication(analyst_id, credential_response):
        raise HTTPException(401, "Passkey authentication failed.")
    user = db.query(models.User).filter(models.User.analyst_id == analyst_id).first()
    if not user:
        raise HTTPException(401, "Unknown analyst.")
    return user