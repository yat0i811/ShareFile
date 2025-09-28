from __future__ import annotations

from app.worker import celery_app


def main() -> None:
    celery_app.worker_main(argv=["worker", "--loglevel=info", "-P", "solo"])


if __name__ == "__main__":
    main()
