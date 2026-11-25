"""Settings, read from environment variables (and a local .env file if present)."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from .errors import ConfigError

DEFAULT_SOURCE_TABLE = "workspace.default.attruby_ia"
_TABLE_RE = re.compile(r"^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}$")


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv()


@dataclass(frozen=True)
class Settings:
    server_hostname: str = ""
    http_path: str = ""
    token: str | None = None          # personal access token; if empty, Databricks SDK auth is used
    source_table: str = DEFAULT_SOURCE_TABLE
    cache_ttl_seconds: int = 300
    pool_size: int = 4
    cors_origins: list[str] = field(default_factory=lambda: ["*"])

    def __post_init__(self) -> None:
        if not _TABLE_RE.match(self.source_table):
            raise ConfigError(f"IA_SOURCE_TABLE '{self.source_table}' is not a valid table name.")

    @classmethod
    def from_env(cls) -> "Settings":
        _load_dotenv()
        host = os.getenv("DATABRICKS_SERVER_HOSTNAME") or os.getenv("DATABRICKS_HOST", "")
        host = re.sub(r"^https?://", "", host.strip()).rstrip("/")
        http_path = os.getenv("DATABRICKS_HTTP_PATH", "").strip()
        warehouse_id = os.getenv("DATABRICKS_WAREHOUSE_ID", "").strip()
        if not http_path and warehouse_id:
            http_path = f"/sql/1.0/warehouses/{warehouse_id}"
        origins = [o.strip() for o in os.getenv("IA_CORS_ORIGINS", "*").split(",") if o.strip()]
        return cls(
            server_hostname=host,
            http_path=http_path,
            token=os.getenv("DATABRICKS_TOKEN") or None,
            source_table=os.getenv("IA_SOURCE_TABLE", DEFAULT_SOURCE_TABLE).strip(),
            cache_ttl_seconds=int(os.getenv("IA_CACHE_TTL_SECONDS", "300")),
            pool_size=max(1, int(os.getenv("IA_POOL_SIZE", "4"))),
            cors_origins=origins or ["*"],
        )

    @property
    def quoted_source_table(self) -> str:
        return ".".join(f"`{part}`" for part in self.source_table.split("."))

    def require_connection_settings(self) -> None:
        missing = [name for name, value in (
            ("DATABRICKS_SERVER_HOSTNAME (or DATABRICKS_HOST)", self.server_hostname),
            ("DATABRICKS_HTTP_PATH (or DATABRICKS_WAREHOUSE_ID)", self.http_path),
        ) if not value]
        if missing:
            raise ConfigError("Missing Databricks settings: " + ", ".join(missing))
