"""
Offline tests (no Databricks needed): the generated SQL runs on an in-memory
SQLite table shaped like attruby_ia and every measure is checked against a
plain-Python reference implementation of the metric-view formulas.

Run:  python -m pytest tests   (or)   python tests/test_backend.py
"""
from __future__ import annotations

import asyncio
import datetime as dt
import pathlib
import random
import sqlite3
import sys
import logging
import tempfile
import threading

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from ia_backend.config import Settings  # noqa: E402
from ia_backend.db import QueryResult  # noqa: E402
from ia_backend.errors import QueryError  # noqa: E402
from ia_backend.semantic_model import MODEL  # noqa: E402
from ia_backend.service import InsightAcceleratorService  # noqa: E402

COLUMNS = [
    "src_table", "crx_ptnt_id", "prgrm_nm", "enrolling_hcp_region", "enrollment_date",
    "enrollment_week_ending_date", "first_fill_date", "new_ptnt_written", "new_ptnt_filled",
    "initiated_therapy", "initiated_not_free_trial_therapy", "initiated_paid_therapy",
    "total_shipments", "refresh_date", "SP_Start_60d_threshold", "SP_Start_60d_include_rule",
    "EnrollmentQuarterStartDate", "FFQuarterStartDate",
    "current_status", "status_change_date", "latest_status_date", "last_shipment_date",
    "total_days_supplied",
]
SQLITE_SAFE_MEASURES = [m for m in MODEL.measures if m != "refresh_timestamp"]  # CURRENT_TIMESTAMP() is Databricks-only


def _make_rows(n: int = 600, seed: int = 7) -> list[dict]:
    rnd = random.Random(seed)
    programs = ["Commercial", "Free Trial", " free trial ", "PAP", None]  # " free trial " tests TRIM
    rows = []
    for i in range(n):
        enrolled = dt.date(2025, 1, 1) + dt.timedelta(days=rnd.randint(0, 300))
        week_end = enrolled + dt.timedelta(days=(5 - enrolled.weekday()) % 7)
        sd = rnd.random() < 0.15
        if sd:  # SD rows carry fractional estimates
            written = round(rnd.uniform(1, 5), 2)
            init = round(written * rnd.uniform(0.3, 0.9), 2)
            not_ft, paid, filled = init, round(init * 0.8, 2), init
        else:
            written = 1
            init = int(rnd.random() < 0.7)
            not_ft = int(init and rnd.random() < 0.85)
            paid = int(not_ft and rnd.random() < 0.8)
            filled = init
        rows.append({
            "src_table": "SD" if sd else rnd.choice(["SP", "HUB"]),
            "crx_ptnt_id": None if sd else f"P{i:05d}",
            "prgrm_nm": rnd.choice(programs),
            "enrolling_hcp_region": rnd.choice(["East", "West", "Central", None]),
            "enrollment_date": enrolled.isoformat(),
            "enrollment_week_ending_date": week_end.isoformat(),
            "first_fill_date": (enrolled + dt.timedelta(days=10)).isoformat() if init else None,
            "new_ptnt_written": written, "new_ptnt_filled": filled,
            "initiated_therapy": init, "initiated_not_free_trial_therapy": not_ft,
            "initiated_paid_therapy": paid, "total_shipments": rnd.randint(0, 12) if init else 0,
            "refresh_date": "2025-11-20 06:00:00", "SP_Start_60d_threshold": 100,
            "SP_Start_60d_include_rule": 1, "EnrollmentQuarterStartDate": None,
            "FFQuarterStartDate": None,
        })
    _add_status_columns(rows, random.Random(seed + 1))  # own RNG: the columns above stay as they were
    return rows


def _add_status_columns(rows: list[dict], rnd: random.Random) -> None:
    for r in rows:
        first = dt.date.fromisoformat(r["first_fill_date"]) if r["first_fill_date"] else None
        status = rnd.choice(["Active - Paid", "Discontinued", " discontinued ", "Pending", None])
        changed = first + dt.timedelta(days=rnd.randint(0, 400)) if first else None
        shipments = r["total_shipments"]
        r.update({
            "current_status": status,
            # some discontinued rows only have latest_status_date (tests the fallback)
            "status_change_date": changed.isoformat() if changed and rnd.random() < 0.8 else None,
            "latest_status_date": changed.isoformat() if changed else None,
            "last_shipment_date": (first + dt.timedelta(days=28 * (shipments - 1) + rnd.randint(0, 20))).isoformat()
                                  if first and shipments else None,
            "total_days_supplied": 28 * shipments,
        })


def _datediff(end, start):
    """Databricks DATEDIFF(end, start) for SQLite."""
    if end is None or start is None:
        return None
    return (dt.date.fromisoformat(str(end)[:10]) - dt.date.fromisoformat(str(start)[:10])).days


class SqliteClient:
    """Stands in for DatabricksClient: same .query() contract."""

    def __init__(self, rows: list[dict]):
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        self.conn.create_function("DATEDIFF", 2, _datediff)
        self.conn.execute(f"CREATE TABLE attruby_ia ({', '.join(COLUMNS)})")
        self.conn.executemany(
            f"INSERT INTO attruby_ia VALUES ({', '.join(':' + c for c in COLUMNS)})", rows)
        self.lock = threading.Lock()
        self.queries: list[tuple[str, dict]] = []

    def query(self, sql, params=None, use_cache=True):
        params = {k: (v.isoformat() if isinstance(v, dt.date) else v) for k, v in (params or {}).items()}
        with self.lock:
            self.queries.append((sql, params))
            cur = self.conn.execute(sql, params)
            cols = [d[0] for d in cur.description]
            return QueryResult(cols, [dict(zip(cols, r)) for r in cur.fetchall()])


ROWS = _make_rows()
logging.getLogger("ia_backend").setLevel(logging.ERROR)  # test table is a column subset on purpose


def _service():
    settings = Settings(source_table="attruby_ia", pool_size=3)
    return InsightAcceleratorService(SqliteClient(ROWS), settings)


# ---- plain-Python reference of the metric-view formulas -------------------- #
def _not_ft(r):
    return r["prgrm_nm"] is not None and r["prgrm_nm"].lower() != "free trial"


def _not_ft_trimmed(r):
    return r["prgrm_nm"] is not None and r["prgrm_nm"].strip().lower() != "free trial"


def _ratio(rows, num, keep=lambda r: True):
    sel = [r for r in rows if keep(r)]
    den = sum(r["new_ptnt_written"] for r in sel)
    return None if not den else sum(r[num] for r in sel) / den


def reference(rows):
    return {
        "new_patients_filled": sum(r["new_ptnt_filled"] for r in rows),
        "total_shipments": sum(r["total_shipments"] for r in rows),
        "new_patients_written": sum(r["new_ptnt_written"] for r in rows),
        "pct_initiated_not_ft": _ratio(rows, "initiated_not_free_trial_therapy"),
        "pct_initiate_paid": _ratio(rows, "initiated_paid_therapy"),
        "pct_initiate_sp": _ratio(rows, "initiated_not_free_trial_therapy"),
        "pct_initiate_therapy": _ratio(rows, "initiated_therapy"),
        "pct_initiate_paid_exclude_ft": _ratio(rows, "initiated_paid_therapy", _not_ft),
        "pct_initiate_sp_excludes_ft": _ratio(rows, "initiated_not_free_trial_therapy", _not_ft_trimmed),
        "initiated_therapy_count": sum(r["initiated_therapy"] for r in rows),
        "initiated_not_ft_count": sum(r["initiated_not_free_trial_therapy"] for r in rows),
        "initiated_paid_count": sum(r["initiated_paid_therapy"] for r in rows),
        "data_refresh_date": max(r["refresh_date"] for r in rows),
        "patients_on_drug": sum(r["initiated_therapy"] for r in rows if not _discontinued(r)),
        "discontinued_patients": sum(r["initiated_therapy"] for r in rows if _discontinued(r)),
        "pct_discontinued": _share(sum(r["initiated_therapy"] for r in rows if _discontinued(r)),
                                   sum(r["initiated_therapy"] for r in rows)),
        "avg_days_between_fills": _share(
            sum(_datediff(r["last_shipment_date"], r["first_fill_date"]) or 0 for r in rows if r["total_shipments"] > 1),
            sum(r["total_shipments"] - 1 for r in rows if r["total_shipments"] > 1)),
        "trx_per_patient": _share(sum(r["total_days_supplied"] for r in rows) / 28,
                                  sum(r["new_ptnt_filled"] for r in rows)),
    }


def _discontinued(r):
    return (r["current_status"] or "").strip().lower() == "discontinued"


def _share(num, den):
    return None if not den else num / den


def _close(a, b):
    if a is None or b is None or isinstance(a, str):
        return a == b
    return abs(float(a) - float(b)) < 1e-9


def _assert_matches(actual: dict, expected: dict):
    for key, value in expected.items():
        assert _close(actual[key], value), f"{key}: got {actual[key]!r}, expected {value!r}"


# ---- tests ---------------------------------------------------------------- #
def test_every_measure_matches_reference_unfiltered():
    kpis = _service().kpis(measures=SQLITE_SAFE_MEASURES)
    _assert_matches(kpis["values"], reference(ROWS))
    assert {f["name"]: f["format"] for f in kpis["fields"]}["pct_initiate_paid"] == "percentage"


def test_trim_difference_between_exclude_ft_measures_is_preserved():
    ref = reference(ROWS)
    # " free trial " is excluded only by the TRIM version, so the two must differ
    assert ref["pct_initiate_sp_excludes_ft"] != _ratio(ROWS, "initiated_not_free_trial_therapy", _not_ft)


def test_filters_in_between_and_blank():
    filters = {"enrolling_hcp_region": ["East", None],
               "enrollment_date": {"between": ["2025-03-01", "2025-08-31"]}}
    keep = [r for r in ROWS if r["enrolling_hcp_region"] in ("East", None)
            and "2025-03-01" <= r["enrollment_date"] <= "2025-08-31"]
    _assert_matches(_service().kpis(filters, SQLITE_SAFE_MEASURES)["values"], reference(keep))


def test_not_in_keeps_blanks_like_power_bi_exclude():
    keep = [r for r in ROWS if r["prgrm_nm"] is None or r["prgrm_nm"] not in ("PAP",)]
    got = _service().kpis({"prgrm_nm": {"not_in": ["PAP"]}}, ["new_patients_written"])
    _assert_matches(got["values"], {"new_patients_written": reference(keep)["new_patients_written"]})


def test_breakdown_by_region_sorted_by_first_measure():
    result = _service().breakdown("enrolling_hcp_region", ["new_patients_written", "pct_initiate_paid"])
    written = [r["new_patients_written"] for r in result.rows]
    assert written == sorted(written, reverse=True)
    for row in result.rows:
        subset = [r for r in ROWS if r["enrolling_hcp_region"] == row["enrolling_hcp_region"]]
        _assert_matches(row, {k: reference(subset)[k] for k in ("new_patients_written", "pct_initiate_paid")})


def test_trend_by_enrollment_week():
    result = _service().trend("enrollment", "week", ["new_patients_written"],
                              start="2025-02-01", end="2025-04-30")
    assert result.meta["period_field"] == "enrollment_by_week"
    periods = [r["enrollment_by_week"] for r in result.rows]
    assert periods == sorted(periods)
    keep = [r for r in ROWS if "2025-02-01" <= r["enrollment_date"] <= "2025-04-30"]
    assert _close(sum(r["new_patients_written"] for r in result.rows), reference(keep)["new_patients_written"])


def test_patients_on_drug_by_month():
    filters = {"enrolling_hcp_region": ["East", "West"]}
    result = _service().patients_on_drug(filters)
    by_month = {r["month"]: r for r in result["rows"]}
    fields = {f["name"]: f for f in result["fields"]}
    assert fields["discontinuation_rate"]["format"] == "percentage"
    assert fields["patients_on_drug"]["type"] == "measure"

    def month(d):
        return d[:7] + "-01" if d else None

    def timeline(rows):  # (start month, stop month or None, weight) per patient, brute force
        out = []
        for r in rows:
            if not r["first_fill_date"]:
                continue
            start = month(r["first_fill_date"])
            stop = max(month(r["status_change_date"] or r["latest_status_date"]) or start, start) \
                if _discontinued(r) else None
            out.append((start, stop, r["initiated_therapy"]))
        return out

    launch = min(month(r["first_fill_date"]) for r in ROWS if r["first_fill_date"])
    assert result["meta"]["launch_month"] == launch
    cohort_last = f"{launch[:5]}{int(launch[5:7]) + 3:02d}-01"  # test data launches in January
    patients = timeline([r for r in ROWS if r["enrolling_hcp_region"] in ("East", "West")])
    assert list(by_month) == sorted(by_month) and min(by_month) == min(s for s, _, _ in patients)
    for m, row in by_month.items():
        on = sum(w for s, e, w in patients if s <= m and (e is None or e >= m))
        stopped = sum(w for _, e, w in patients if e == m)
        cohort = [(s, e, w) for s, e, w in patients if launch <= s <= cohort_last]
        cohort_started = sum(w for s, _, w in cohort if s <= m)
        cohort_stopped = sum(w for _, e, w in cohort if e and e <= m)
        assert _close(row["patients_on_drug"], on), m
        assert _close(row["new_patients_on_drug"], sum(w for s, _, w in patients if s == m)), m
        assert _close(row["new_patients_on_drug"] + row["continuing_patients_on_drug"], on), m
        assert _close(row["discontinued_patients"], stopped), m
        assert _close(row["discontinuation_rate"], stopped / on if on else None), m
        assert _close(row["launch_cohort_cum_discontinuation"],
                      cohort_stopped / cohort_started if cohort_started else None), m


def test_funnel():
    stages = _service().funnel()
    ref = reference(ROWS)
    assert [s["stage"] for s in stages] == ["Written", "Initiated therapy", "Initiated non-free-trial", "Initiated paid"]
    assert _close(stages[3]["value"], ref["initiated_paid_count"])
    assert _close(stages[3]["pct_of_written"], ref["initiated_paid_count"] / ref["new_patients_written"])


def test_patients_paging():
    svc = _service()
    page1 = svc.patients(["crx_ptnt_id", "enrollment_date"], {"src_table": ["SP", "HUB"]}, limit=50)
    page2 = svc.patients(["crx_ptnt_id", "enrollment_date"], {"src_table": ["SP", "HUB"]}, limit=50, offset=50)
    assert page1["total"] == sum(1 for r in ROWS if r["src_table"] in ("SP", "HUB"))
    assert len(page1["rows"]) == 50 and len(page2["rows"]) == 50
    assert page1["rows"][0]["enrollment_date"] >= page1["rows"][-1]["enrollment_date"]
    assert not {r["crx_ptnt_id"] for r in page1["rows"]} & {r["crx_ptnt_id"] for r in page2["rows"]}


def test_filter_options_cascade():
    opts = _service().filter_options(["enrolling_hcp_region", "src_table"],
                                     {"enrolling_hcp_region": ["East"], "src_table": ["SD"]})
    # a slicer ignores its own selection but respects the others
    assert set(opts["enrolling_hcp_region"]) == {r["enrolling_hcp_region"] for r in ROWS if r["src_table"] == "SD"}
    assert set(opts["src_table"]) == {r["src_table"] for r in ROWS if r["enrolling_hcp_region"] == "East"}


def test_measures_accept_original_metric_view_names():
    got = _service().query(["% Initiated_not_FT", "%_Initiate_SP_Excludes_FT"],
                           ["src_table"], order_by=["% Initiated_not_FT desc"])
    assert got.columns == ["src_table", "pct_initiated_not_ft", "pct_initiate_sp_excludes_ft"]


def test_values_are_parameters_never_sql():
    svc = _service()
    svc.kpis({"prgrm_nm": "x'); DROP TABLE attruby_ia; --"}, ["new_patients_written"])
    sql, params = svc.client.queries[-1]
    assert "DROP" not in sql and "DROP TABLE" in list(params.values())[0]


def test_rejects_unknown_names_and_operators():
    svc = _service()
    bad_calls = [
        lambda: svc.query(["new_patients_written"], ["region; DROP TABLE x"]),
        lambda: svc.query(["not_a_measure"]),
        lambda: svc.kpis({"prgrm_nm": {"regex": ".*"}}),
        lambda: svc.kpis({"enrollment_date": {"gte": "not-a-date"}}),
        lambda: svc.query(["new_patients_written"], ["src_table"], order_by=["total_shipments"]),
        lambda: svc.trend("enrollment", "decade"),
    ]
    for call in bad_calls:
        try:
            call()
        except QueryError:
            continue
        raise AssertionError("expected QueryError")


def test_missing_calculated_columns_are_computed():
    class NoDerivedColumns(SqliteClient):
        def query(self, sql, params=None, use_cache=True):
            result = super().query(sql, params, use_cache)
            if "LIMIT 0" in sql:
                result.columns = [c for c in result.columns if not c.startswith(("SP_", "Enrollment", "FF"))]
            return result

    svc = InsightAcceleratorService(NoDerivedColumns(ROWS[:5]), Settings(source_table="attruby_ia"))
    source = svc.builder.source_from
    assert source.startswith("(SELECT *, DATEDIFF(CURRENT_DATE(), enrollment_date) - 1 AS `SP_Start_60d_threshold`")
    assert "DATE_TRUNC('QUARTER', first_fill_date)" in source
    assert sorted(svc.schema_info["computed_in_backend"]) == sorted(
        ["SP_Start_60d_threshold", "SP_Start_60d_include_rule", "EnrollmentQuarterStartDate", "FFQuarterStartDate"])


def test_text_stored_columns_are_typed_like_the_model():
    class TextUpload(SqliteClient):
        def query(self, sql, params=None, use_cache=True):
            result = super().query(sql, params, use_cache)
            if "LIMIT 0" in sql:  # like a CSV upload: text columns, no calculated columns
                result.columns = [c for c in result.columns if not c.startswith(("SP_", "Enrollment", "FF"))]
                result.column_types = ["bigint" if c == "total_shipments" else "string" for c in result.columns]
            return result

    svc = InsightAcceleratorService(TextUpload(ROWS[:5]), Settings(source_table="attruby_ia"))
    source = svc.builder.source_from
    assert "TRY_CAST(`new_ptnt_filled` AS DOUBLE) AS `new_ptnt_filled`" in source
    assert "TRY_CAST(`enrollment_date` AS DATE) AS `enrollment_date`" in source
    assert "TRY_CAST(`refresh_date` AS TIMESTAMP) AS `refresh_date`" in source
    assert "NULLIF(`prgrm_nm`, 'null') AS `prgrm_nm`" in source
    assert "`total_shipments`" not in source  # already numeric: left as is
    # calculated columns are computed from the typed columns
    assert source.startswith("(SELECT *, DATEDIFF(CURRENT_DATE(), enrollment_date) - 1")
    assert "FROM (SELECT * EXCEPT (`src_table`, " in source and source.endswith(") AS typed) AS source")
    assert "new_ptnt_filled" in svc.schema_info["text_columns_typed_in_backend"]
    assert "prgrm_nm" not in svc.schema_info["text_columns_typed_in_backend"]


def _asgi_get(app, path: str):
    """In-process GET against the ASGI app (no server, no extra dependencies)."""
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
             "scheme": "http", "path": path, "raw_path": path.encode(), "root_path": "",
             "query_string": b"", "headers": [(b"host", b"test")],
             "client": ("test", 1), "server": ("test", 80)}

    async def call() -> list[dict]:
        sent: list[dict] = []
        finished = asyncio.Event()
        requested = False

        async def receive():
            nonlocal requested
            if not requested:
                requested = True
                return {"type": "http.request", "body": b"", "more_body": False}
            await finished.wait()  # report a disconnect only once the response is complete
            return {"type": "http.disconnect"}

        async def send(message):
            sent.append(message)
            if message["type"] == "http.response.body" and not message.get("more_body"):
                finished.set()

        await asyncio.wait_for(app(scope, receive, send), timeout=10)
        return sent

    sent = asyncio.run(call())
    start = next(m for m in sent if m["type"] == "http.response.start")
    headers = {k.decode().lower(): v.decode() for k, v in start["headers"]}
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], headers, body


def test_frontend_is_served_at_root_without_shadowing_the_api():
    from main import create_app

    with tempfile.TemporaryDirectory() as tmp:
        dist = pathlib.Path(tmp)
        (dist / "assets").mkdir()
        (dist / "index.html").write_text('<div id="root"></div>')
        (dist / "assets" / "index-abc123.js").write_text("console.log(1)")
        app = create_app(Settings(), frontend_dist=dist)

        status, headers, body = _asgi_get(app, "/")
        assert status == 200 and b'id="root"' in body
        assert headers.get("cache-control") == "no-cache"
        status, headers, _ = _asgi_get(app, "/assets/index-abc123.js")
        assert status == 200 and "cache-control" not in headers
        for path in ("/api/health", "/docs", "/openapi.json"):
            assert _asgi_get(app, path)[0] == 200, path
        status, _, body = _asgi_get(app, "/api/not-a-route")
        assert status == 404 and b'id="root"' not in body

        api_only = create_app(Settings(), frontend_dist=dist / "missing")
        assert _asgi_get(api_only, "/api/health")[0] == 200
        assert _asgi_get(api_only, "/")[0] == 404


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        fn()
        print(f"PASS {name}")
    print(f"\n{len(tests)} tests passed")
