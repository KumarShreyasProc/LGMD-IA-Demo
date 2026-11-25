"""Error types raised by the Insight Accelerator backend."""


class QueryError(ValueError):
    """The request asked for something invalid (unknown field, bad filter...). Maps to HTTP 400."""


class DatabaseError(RuntimeError):
    """Databricks rejected or failed the query. Maps to HTTP 502."""


class ConfigError(RuntimeError):
    """The backend is not configured correctly (missing host, warehouse...). Maps to HTTP 500."""
