"""PostgreSQL utilities for ETL worker."""

import logging
import os
from typing import List

import psycopg2

logger = logging.getLogger(__name__)

_connection = None


def _get_connection():
    """Get a lazily initialized shared PostgreSQL connection."""
    global _connection

    if _connection is not None and _connection.closed == 0:
        return _connection

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        return None

    _connection = psycopg2.connect(database_url, connect_timeout=5)
    _connection.autocommit = True
    return _connection


def update_broken_pages(exchange: str, source_id: str, broken_pages: List[int]) -> None:
    """Update broken pages in filings table.

    Fail-open by design: errors are logged and swallowed.
    """
    if not exchange or not source_id or not broken_pages:
        return

    global _connection
    try:
        conn = _get_connection()
        if conn is None:
            return

        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE filings
                SET broken_pages = %s
                WHERE exchange = %s AND source_id = %s
                """,
                (broken_pages, exchange, source_id),
            )
    except Exception as exc:
        logger.warning(
            "Failed to update broken_pages for %s:%s: %s",
            exchange,
            source_id,
            exc,
        )
        if _connection is not None:
            try:
                _connection.close()
            except Exception:
                pass
            _connection = None
