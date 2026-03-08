import argparse

from sqlalchemy import select

from app.database import SessionLocal
from app.models import User
from app.security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a BUC user")
    parser.add_argument("--buc-id", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument("--role", default="member")
    parser.add_argument("--color", default="#d8d8d8")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        existing = db.scalar(select(User).where(User.buc_id == args.buc_id.strip()))
        if existing:
            raise SystemExit("BUC ID already exists")

        user = User(
            buc_id=args.buc_id.strip(),
            display_name=args.display_name.strip(),
            password_hash=hash_password(args.password),
            role=args.role.strip(),
            color=args.color.strip(),
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"Created user {user.buc_id}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
