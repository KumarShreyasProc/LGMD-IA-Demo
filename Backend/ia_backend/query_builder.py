"""
Safe SQL generation on top of the semantic model.

Callers only pass *names* (dimensions, measures) and *values* (filter values).
Names are checked against the semantic model whitelist and values are sent as
named parameters (:p0, :p1, ...), so nothing user-supplied is concatenated into SQL.

Filter format (same for every endpoint), keyed by dimension name:

    {"enrolling_hcp_region": ["East", "West"]}            -> IN (blank = None)
    {"prgrm_nm": "Commercial"}                            -> =
    {"enrollment_date": {"between": ["2025-01-01", "2025-06-30"]}}
    {"enrollment_pyr_typ": {"not_in": ["Medicaid"]}}
    {"first_fill_date": {"is_null": false}}
    {"enrolling_hcp_name": {"contains": "smith"}}
    operators: eq ne gt gte lt lte in not_in between is_null contains
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from .errors import QueryError
from .semantic_model import Dimension, SemanticModel

MAX_AGGREGATE_ROWS = 50_000
MAX_DETAIL_ROWS = 10_000

_COMPARISON_OPS = {"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
SUPPORTED_OPERATORS = (*_COMPARISON_OPS, "in", "not_in", "between", "is_null", "contains")


@dataclass(frozen=True)
class SqlQuery:
    sql: str
    params: dict[str, Any]


def quote_ident(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def normalize_filter_spec(spec: Any) -> dict[str, Any]:
    if spec is None:
        return {"is_null": True}
    if isinstance(spec, Mapping):
        return dict(spec)
    if isinstance(spec, (list, tuple, set)):
        return {"in": list(spec)}
    return {"eq": spec}


def merge_filters(filters: Mapping[str, Any] | None, name: str, extra: dict) -> dict:
    """Add operators for one dimension without dropping what the caller already set."""
    merged = dict(filters or {})
    merged[name] = {**normalize_filter_spec(merged[name]), **extra} if name in merged else dict(extra)
    return merged


class _Params:
    def __init__(self) -> None:
        self.values: dict[str, Any] = {}

    def add(self, value: Any) -> str:
        key = f"p{len(self.values)}"
        self.values[key] = value
        return f":{key}"


def _parse_order(item: str) -> tuple[str, bool]:
    """'-x' or 'x desc' -> (x, True); 'x' or 'x asc' -> (x, False)."""
    item = str(item).strip()
    if item.startswith("-"):
        return item[1:].strip(), True
    parts = item.rsplit(None, 1)
    if len(parts) == 2 and parts[1].lower() in ("asc", "desc"):
        return parts[0].strip(), parts[1].lower() == "desc"
    return item, False


def _limit(value: Any, maximum: int) -> int | None:
    if value is None:
        return None
    n = int(value)
    if not 1 <= n <= maximum:
        raise QueryError(f"limit must be between 1 and {maximum}")
    return n


def _as_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "y")
    return bool(value)


def _escape_like(text: str) -> str:
    return text.replace("!", "!!").replace("%", "!%").replace("_", "!_")


def _coerce(dim: Dimension, value: Any) -> Any:
    """Turn ISO date strings into dates for date dimensions (validates them too)."""
    if dim.kind == "date" and isinstance(value, str):
        try:
            return dt.date.fromisoformat(value.strip()[:10])
        except ValueError:
            raise QueryError(f"'{value}' is not a valid date for '{dim.name}' (use YYYY-MM-DD).")
    if isinstance(value, (dict, list, tuple, set)):
        raise QueryError(f"Unexpected nested value in filter on '{dim.name}'.")
    return value


class QueryBuilder:
    def __init__(self, model: SemanticModel, source_from: str):
        self.model = model
        self.source_from = source_from  # e.g. "`workspace`.`default`.`attruby_ia` AS source"

    # ------------------------------------------------------------------ #
    def aggregate(self, measures: Iterable[str] = (), dimensions: Iterable[str] = (),
                  filters: Mapping[str, Any] | None = None, order_by: Iterable[str] | None = (),
                  limit: int | None = None) -> SqlQuery:
        dims = [self.model.dimension(n) for n in dimensions]
        meas = [self.model.measure(n) for n in measures]
        if not dims and not meas:
            raise QueryError("Select at least one measure or dimension.")
        aliases = [d.name for d in dims] + [m.name for m in meas]
        if len(set(aliases)) != len(aliases):
            raise QueryError("Each dimension/measure can only be selected once per query.")

        params = _Params()
        select = [f"{d.expr} AS {quote_ident(d.name)}" for d in dims]
        select += [f"{m.expr} AS {quote_ident(m.name)}" for m in meas]
        sql = ["SELECT\n  " + ",\n  ".join(select), f"FROM {self.source_from}"]
        where = self._where(filters, params)
        if where:
            sql.append(f"WHERE {where}")
        if dims:
            sql.append("GROUP BY " + ", ".join(d.expr for d in dims))

        order = []
        for item in order_by or ():
            name, desc = _parse_order(item)
            alias = self._selected_alias(name, set(aliases))
            order.append(f"{quote_ident(alias)} {'DESC' if desc else 'ASC'} NULLS LAST")
        if order:
            sql.append("ORDER BY " + ", ".join(order))
        n = _limit(limit, MAX_AGGREGATE_ROWS)
        if n:
            sql.append(f"LIMIT {n}")
        return SqlQuery("\n".join(sql), params.values)

    def detail(self, columns: Iterable[str], filters: Mapping[str, Any] | None = None,
               order_by: Iterable[str] | None = (), limit: int = 100, offset: int = 0) -> SqlQuery:
        dims = [self.model.dimension(c) for c in columns]
        if not dims:
            raise QueryError("Select at least one column.")
        if len({d.name for d in dims}) != len(dims):
            raise QueryError("Each column can only be selected once.")
        params = _Params()
        sql = ["SELECT\n  " + ",\n  ".join(f"{d.expr} AS {quote_ident(d.name)}" for d in dims),
               f"FROM {self.source_from}"]
        where = self._where(filters, params)
        if where:
            sql.append(f"WHERE {where}")
        order = []
        for item in order_by or ():
            name, desc = _parse_order(item)
            order.append(f"{self.model.dimension(name).expr} {'DESC' if desc else 'ASC'} NULLS LAST")
        if order:
            sql.append("ORDER BY " + ", ".join(order))
        offset = int(offset)
        if offset < 0:
            raise QueryError("offset must be >= 0")
        sql.append(f"LIMIT {_limit(limit, MAX_DETAIL_ROWS) or 100} OFFSET {offset}")
        return SqlQuery("\n".join(sql), params.values)

    def count(self, filters: Mapping[str, Any] | None = None) -> SqlQuery:
        params = _Params()
        sql = [f"SELECT COUNT(*) AS {quote_ident('row_count')}", f"FROM {self.source_from}"]
        where = self._where(filters, params)
        if where:
            sql.append(f"WHERE {where}")
        return SqlQuery("\n".join(sql), params.values)

    def distinct_values(self, dimension: str, filters: Mapping[str, Any] | None = None,
                        limit: int = 500) -> SqlQuery:
        dim = self.model.dimension(dimension)
        params = _Params()
        sql = [f"SELECT DISTINCT {dim.expr} AS {quote_ident('value')}", f"FROM {self.source_from}"]
        where = self._where(filters, params)
        if where:
            sql.append(f"WHERE {where}")
        sql.append(f"ORDER BY {quote_ident('value')} ASC NULLS LAST")
        sql.append(f"LIMIT {_limit(limit, MAX_DETAIL_ROWS)}")
        return SqlQuery("\n".join(sql), params.values)

    # ------------------------------------------------------------------ #
    def _selected_alias(self, name: str, selected: set[str]) -> str:
        for lookup in (self.model.measure, self.model.dimension):
            try:
                alias = lookup(name).name
            except QueryError:
                continue
            if alias in selected:
                return alias
        raise QueryError(f"Cannot order by '{name}': it is not selected in this query.")

    def _where(self, filters: Mapping[str, Any] | None, params: _Params) -> str:
        if filters is not None and not isinstance(filters, Mapping):
            raise QueryError("filters must be an object keyed by dimension name.")
        clauses: list[str] = []
        for name, spec in (filters or {}).items():
            dim = self.model.dimension(name)
            clauses.extend(self._compile(dim, normalize_filter_spec(spec), params))
        return " AND ".join(f"({c})" for c in clauses)

    def _compile(self, dim: Dimension, spec: dict, params: _Params) -> list[str]:
        col = dim.expr
        out: list[str] = []
        for op, value in spec.items():
            if op in _COMPARISON_OPS:
                if value is None:
                    raise QueryError(f"'{op}' on '{dim.name}' needs a value (use is_null for blanks).")
                out.append(f"{col} {_COMPARISON_OPS[op]} {params.add(_coerce(dim, value))}")

            elif op in ("in", "not_in"):
                values = list(value) if isinstance(value, (list, tuple, set)) else [value]
                present = [_coerce(dim, v) for v in values if v is not None]
                blanks = len(present) != len(values)  # None in the list = "(Blank)"
                markers = ", ".join(params.add(v) for v in present)
                if op == "in":
                    parts = ([f"{col} IN ({markers})"] if present else []) + \
                            ([f"{col} IS NULL"] if blanks else [])
                    out.append(" OR ".join(parts) if parts else "1 = 0")
                elif present and blanks:
                    out.append(f"{col} IS NOT NULL AND {col} NOT IN ({markers})")
                elif present:  # like Power BI "exclude": blanks stay in
                    out.append(f"{col} IS NULL OR {col} NOT IN ({markers})")
                elif blanks:
                    out.append(f"{col} IS NOT NULL")

            elif op == "between":
                if not isinstance(value, (list, tuple)) or len(value) != 2:
                    raise QueryError(f"'between' on '{dim.name}' needs [low, high].")
                low, high = value
                if low is not None:
                    out.append(f"{col} >= {params.add(_coerce(dim, low))}")
                if high is not None:
                    out.append(f"{col} <= {params.add(_coerce(dim, high))}")

            elif op == "is_null":
                out.append(f"{col} IS NULL" if _as_bool(value) else f"{col} IS NOT NULL")

            elif op == "contains":
                if value in (None, ""):
                    continue
                pattern = "%" + _escape_like(str(value).lower()) + "%"
                out.append(f"LOWER(CAST({col} AS STRING)) LIKE {params.add(pattern)} ESCAPE '!'")

            else:
                raise QueryError(f"Unsupported filter operator '{op}' on '{dim.name}'. "
                                 f"Use one of: {', '.join(SUPPORTED_OPERATORS)}.")
        return out
