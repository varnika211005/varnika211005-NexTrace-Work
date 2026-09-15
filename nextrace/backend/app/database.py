"""
Database configuration.

Uses SQLite by default so the project runs with zero external setup.
To switch to PostgreSQL, set DATABASE_URL, e.g.:

    export DATABASE_URL="postgresql://user:password@localhost:5432/nextrace"
    pip install psycopg2-binary

No other code changes are required - SQLAlchemy handles both.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./nextrace.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
