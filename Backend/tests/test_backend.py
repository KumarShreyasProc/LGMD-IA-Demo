"""
Offline tests (no Databricks needed): the generated SQL runs on an in-memory
SQLite table shaped like attruby_ia and every measure is checked against a
plain-Python reference implementation of the metric-view formulas.

Run:  python -m pytest tests   (or)   python tests/test_backend.py
"""
from __future__ import annotations

import datetime as dt
import pathlib
import random
import sqlite3
import sys
import logging
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
    return rows


class SqliteClient:
    """Stands in for DatabricksClient: same .query() contract."""

    def __init__(self, rows: list[dict]):
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
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
    }


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


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        fn()
        print(f"PASS {name}")
    print(f"\n{len(tests)} tests passed")
