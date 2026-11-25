"""Databricks SQL warehouse access: connection pool, TTL cache, JSON-friendly results."""
from __future__ import annotations

import logging
import queue
import threading
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from .config import Settings
from .errors import DatabaseError

log = logging.getLogger(__name__)


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    fields: list[dict] = field(default_factory=list)   # display metadata per column
    meta: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        out = {"columns": self.columns, "fields": self.fields, "rows": self.rows}
        if self.meta:
            out["meta"] = self.meta
        return out

    def to_dataframe(self):
        """For Dash / Streamlit / notebooks (requires pandas)."""
        import pandas as pd
        return pd.DataFrame(self.rows, columns=self.columns)


def _plain(value: Any) -> Any:
    """Decimal -> int/float so JSON and charts get numbers, not strings."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


class _TTLCache:
    def __init__(self, ttl_seconds: int, max_entries: int = 512):
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self._data: dict[Any, tuple[float, QueryResult]] = {}
        self._lock = threading.Lock()

    def get(self, key):
        if self.ttl <= 0:
            return None
        with self._lock:
            hit = self._data.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            self._data.pop(key, None)
            return None

    def set(self, key, value: QueryResult) -> None:
        if self.ttl <= 0:
            return
        with self._lock:
            if len(self._data) >= self.max_entries:
                self._data.pop(next(iter(self._data)))  # drop oldest entry
            self._data[key] = (time.monotonic() + self.ttl, value)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


class DatabricksClient:
    """Runs parameterized SQL on a Databricks SQL warehouse.

    Auth: DATABRICKS_TOKEN if set, otherwise the Databricks SDK default chain
    (this is what a Databricks App's service principal uses automatically).
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self._pool: queue.LifoQueue = queue.LifoQueue(maxsize=settings.pool_size)
        self.cache = _TTLCache(settings.cache_ttl_seconds)

    # ---- connections --------------------------------------------------- #
    def _connect(self):
        self.settings.require_connection_settings()
        from databricks import sql  # imported lazily so the rest of the package works without it

        kwargs: dict[str, Any] = {
            "server_hostname": self.settings.server_hostname,
            "http_path": self.settings.http_path,
        }
        if self.settings.token:
            kwargs["access_token"] = self.settings.token
        else:
            from databricks.sdk.core import Config
            cfg = Config()
            kwargs["credentials_provider"] = lambda: cfg.authenticate
        return sql.connect(**kwargs)

    def _acquire(self):
        try:
            return self._pool.get_nowait(), True
        except queue.Empty:
            return self._connect(), False

    def _release(self, conn) -> None:
        try:
            self._pool.put_nowait(conn)
        except queue.Full:
            self._discard(conn)

    @staticmethod
    def _discard(conn) -> None:
        try:
            conn.close()
        except Exception:  # noqa: BLE001 - closing a broken connection may fail
            pass

    def close(self) -> None:
        while True:
            try:
                self._discard(self._pool.get_nowait())
            except queue.Empty:
                return

    # ---- queries ------------------------------------------------------- #
    def query(self, sql: str, params: dict[str, Any] | None = None,
              use_cache: bool = True) -> QueryResult:
        params = params or {}
        key = (sql, tuple(sorted(params.items())))
        if use_cache and (cached := self.cache.get(key)) is not None:
            return cached
        result = self._execute(sql, params)
        if use_cache:
            self.cache.set(key, result)
        return result

    def _execute(self, sql: str, params: dict[str, Any]) -> QueryResult:
        for attempt in (1, 2):
            conn, reused = self._acquire()
            started = time.perf_counter()
            try:
                with conn.cursor() as cursor:
                    cursor.execute(sql, parameters=params or None)
                    columns = [d[0] for d in cursor.description or []]
                    rows = [{c: _plain(v) for c, v in zip(columns, row)} for row in cursor.fetchall()]
            except Exception as exc:  # noqa: BLE001
                self._discard(conn)
                if attempt == 1 and reused:  # pooled connection may have expired: retry once
                    log.info("Retrying query on a fresh connection after: %s", exc)
                    continue
                log.error("Query failed: %s\nSQL:\n%s\nparams=%s", exc, sql, params)
                raise DatabaseError(str(exc)) from exc
            self._release(conn)
            log.debug("%d rows in %.2fs\n%s\nparams=%s", len(rows),
                      time.perf_counter() - started, sql, params)
            return QueryResult(columns, rows)
        raise DatabaseError("Query failed after retry.")  # pragma: no cover
