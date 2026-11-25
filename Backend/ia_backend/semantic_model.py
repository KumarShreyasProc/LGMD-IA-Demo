"""
Semantic model for the Insight Accelerator (IA) dashboard.

Ported from the Databricks metric view built on
comm_dev.pdm_dev_ml_experiments.v_patient_detail_attr (itself migrated from the
Power BI model "Insight Accelerator.pbit", table patient_detail_attr).

Every dimension and measure keeps the metric view's expression, so the Python
dashboard returns the same numbers as the native Databricks dashboard. All SQL
expressions reference the data through the alias ``source``, exactly like the
metric view does; the query builder supplies ``FROM <table> AS source``.

Measures skipped in the metric view (Chart Title, Filters_In_Use,
DateFilters_In_Use) depended on Power BI slicer state. In this app the frontend
knows which filters are active, so it builds those labels itself.
"""
from __future__ import annotations

from dataclasses import dataclass

from .errors import QueryError


@dataclass(frozen=True)
class Dimension:
    name: str
    label: str
    kind: str          # "string" | "number" | "date" | "timestamp"
    expr: str          # SQL expression over alias `source`
    column: str        # base column it reads (used to check the table has it)
    derived: bool = False  # True = added for this app, not in the metric view


@dataclass(frozen=True)
class Measure:
    name: str          # API key (snake_case)
    label: str         # original metric-view measure name
    expr: str
    description: str
    format: str = "number"   # "number" | "percentage" | "timestamp"
    decimals: int = 0
    origin: str = "metric_view"  # "metric_view" or "added"


# --------------------------------------------------------------------------- #
# Dimensions (every dimension in the metric view, each expr = source.<name>)
# --------------------------------------------------------------------------- #
_DIMENSION_TABLE = """
src_table                        | string    | Source data table identifier
refresh_date                     | timestamp | Data refresh timestamp
crx_ptnt_id                      | string    | Patient identifier
ptnt_gndr                        | string    | Patient gender
ptnt_yob                         | number    | Patient year of birth
ptnt_st                          | string    | Patient state
ltst_sp_ptnt_id                  | string    | Latest specialty pharmacy patient ID
previous_targeted_therapy        | string    | Previous targeted therapy
prgrm_nm                         | string    | Program name
intgd_ptnt_stat                  | string    | Integrated patient status
rmh_isp_nm                       | string    | ISP name
enrollment_pharmacy              | string    | Enrollment pharmacy
sd_acct_nm                       | string    | SD account name
enrollment_date                  | date      | Patient enrollment date
enrollment_week_ending_date      | date      | Enrollment week ending date
enrollment_month                 | string    | Enrollment month
enrollment_quarter               | string    | Enrollment quarter
enrollment_year                  | string    | Enrollment year
enrollment_hcp_id                | string    | Enrolling HCP identifier
enrollment_crx_pyr_id            | string    | Enrollment payer ID
enrollment_pyr_nm                | string    | Enrollment payer name
enrollment_plan_nm               | string    | Enrollment plan name
enrollment_pcn                   | string    | Enrollment PCN
enrollment_pbm                   | string    | Enrollment PBM
enrollment_pyr_typ               | string    | Enrollment payer type
enrolling_hcp_npi                | string    | Enrolling HCP NPI
enrolling_hcp_mdm_id             | string    | Enrolling HCP MDM ID
enrolling_hcp_name               | string    | Enrolling HCP name
enrolling_hcp_specialty          | string    | Enrolling HCP specialty
enrolling_hcp_segment            | string    | Enrolling HCP segment
enrolling_hcp_priority           | string    | Enrolling HCP priority
enrolling_hcp_taf_decile         | string    | Enrolling HCP TAF decile
enrolling_hcp_trgt               | string    | Enrolling HCP target status
enrolling_hcp_hco                | string    | Enrolling HCP HCO affiliation
enrolling_hcp_address            | string    | Enrolling HCP address
enrolling_hcp_city               | string    | Enrolling HCP city
enrolling_hcp_state              | string    | Enrolling HCP state
enrolling_hcp_zip                | string    | Enrolling HCP zip code
enrolling_hcp_geo_id             | string    | Enrolling HCP geography ID
enrolling_hcp_territory          | string    | Enrolling HCP territory
enrolling_hcp_region             | string    | Enrolling HCP region
enrolling_hcp_area               | string    | Enrolling HCP area
first_fill_date                  | date      | First fill date
first_fill_week_ending           | date      | First fill week ending date
first_fill_month                 | string    | First fill month
first_fill_quarter               | string    | First fill quarter
first_fill_year                  | string    | First fill year
first_fill_shipment_type         | string    | First fill shipment type
first_not_ft_fill_date           | date      | First non-free-trial fill date
first_not_ft_week_ending         | date      | First non-FT fill week ending
first_not_ft_month               | string    | First non-FT fill month
first_not_ft_quarter             | string    | First non-FT fill quarter
first_not_ft_year                | string    | First non-FT fill year
first_not_ft_shipment_type       | string    | First non-FT shipment type
first_paid_fill_date             | date      | First paid fill date
first_paid_week_ending           | date      | First paid fill week ending
first_paid_month                 | string    | First paid fill month
first_paid_quarter               | string    | First paid fill quarter
first_paid_year                  | string    | First paid fill year
first_paid_shipment_type         | string    | First paid shipment type
first_paid_sp                    | string    | First paid specialty pharmacy
last_shipment_sp                 | string    | Last shipment specialty pharmacy
last_shipment_disp_type          | string    | Last shipment dispense type
last_shipment_date               | date      | Last shipment date
current_end_of_supply            | date      | Current end of supply date
current_status                   | string    | Current patient status
current_sub_status               | string    | Current patient sub-status
latest_status_date               | date      | Latest status date
status_change_date               | date      | Status change date
status_change_week_ending        | date      | Status change week ending
status_change_month              | string    | Status change month
status_change_quarter            | string    | Status change quarter
status_change_year               | string    | Status change year
dc_last_ship_dt                  | date      | DC last shipment date
dc_last_day_of_supply            | date      | DC last day of supply
total_days_supplied              | number    | Total days supplied
SP_Start_60d_threshold           | number    | Days since enrollment minus 1 (60-day SP start rule threshold)
SP_Start_60d_include_rule        | number    | 1 if the SP start threshold exceeds 59 days, else 0
EnrollmentQuarterStartDate       | date      | Quarter start date for enrollment date
FFQuarterStartDate               | date      | Quarter start date for first fill date
initiated_therapy                | number    | Therapy initiation flag (SP/HUB 1/0; SD rows = SD filled estimate)
initiated_not_free_trial_therapy | number    | Non-free-trial initiation flag (SP/HUB 1/0; SD rows = SD filled estimate)
initiated_paid_therapy           | number    | Paid initiation flag (SP/HUB 1/0; SD rows = SD filled estimate)
new_ptnt_written                 | number    | Patients written (SP/HUB always 1; SD rows = estimated written)
new_ptnt_filled                  | number    | Patients filled (SP/HUB 1 if any shipment; SD rows = estimated filled)
total_shipments                  | number    | Shipment records for the patient across all dispense types
"""


def _parse_dimensions(table: str) -> list[Dimension]:
    dims = []
    for line in table.strip().splitlines():
        name, kind, label = (part.strip() for part in line.split("|", 2))
        dims.append(Dimension(name=name, label=label, kind=kind, expr=f"source.{name}", column=name))
    return dims


# Columns the metric view's source view materialised from 4 DAX calculated
# columns. If workspace.default.attruby_ia does not already contain them, the
# service computes them on the fly with these expressions (Databricks SQL).
DERIVED_SOURCE_COLUMNS: dict[str, str] = {
    "SP_Start_60d_threshold": "DATEDIFF(CURRENT_DATE(), enrollment_date) - 1",
    "SP_Start_60d_include_rule": (
        "CASE WHEN DATEDIFF(CURRENT_DATE(), enrollment_date) - 1 > 59 THEN 1 ELSE 0 END"
    ),
    "EnrollmentQuarterStartDate": "CAST(DATE_TRUNC('QUARTER', enrollment_date) AS DATE)",
    "FFQuarterStartDate": "CAST(DATE_TRUNC('QUARTER', first_fill_date) AS DATE)",
}


# --------------------------------------------------------------------------- #
# Period dimensions for trend charts (added for the app)
# basis -> (date column, precomputed week-ending column, label)
# --------------------------------------------------------------------------- #
DATE_BASES: dict[str, tuple[str, str, str]] = {
    "enrollment": ("enrollment_date", "enrollment_week_ending_date", "Enrollment"),
    "first_fill": ("first_fill_date", "first_fill_week_ending", "First fill"),
    "first_not_ft": ("first_not_ft_fill_date", "first_not_ft_week_ending", "First non-FT fill"),
    "first_paid": ("first_paid_fill_date", "first_paid_week_ending", "First paid fill"),
    "status_change": ("status_change_date", "status_change_week_ending", "Status change"),
}
GRAINS = ("week", "month", "quarter", "year")


def _period_dimensions() -> list[Dimension]:
    dims = []
    for basis, (date_col, week_col, label) in DATE_BASES.items():
        # Week uses the precomputed week-ending column so weeks line up with Power BI.
        dims.append(Dimension(f"{basis}_by_week", f"{label} (week ending)", "date",
                              f"source.{week_col}", week_col, derived=True))
        for grain in ("month", "quarter", "year"):
            dims.append(Dimension(
                f"{basis}_by_{grain}", f"{label} ({grain} start)", "date",
                f"CAST(DATE_TRUNC('{grain.upper()}', source.{date_col}) AS DATE)",
                date_col, derived=True,
            ))
    return dims


# --------------------------------------------------------------------------- #
# Measures
# --------------------------------------------------------------------------- #
# The two "Exclude FT" measures differ on purpose: Paid uses LOWER(prgrm_nm),
# SP uses LOWER(TRIM(prgrm_nm)), matching the metric view / DAX exactly.
_PROGRAM_NOT_FT = "source.prgrm_nm IS NOT NULL AND LOWER(source.prgrm_nm) <> 'free trial'"
_PROGRAM_NOT_FT_TRIMMED = (
    "source.prgrm_nm IS NOT NULL AND LOWER(TRIM(source.prgrm_nm)) <> 'free trial'"
)


def _ratio(numerator: str, denominator: str = "new_ptnt_written", where: str | None = None) -> str:
    """SUM(num) / SUM(den), NULL when the denominator is 0 (same as the metric view's CASE)."""
    flt = f" FILTER (WHERE {where})" if where else ""
    return (f"CAST(SUM(source.{numerator}){flt} AS DOUBLE) "
            f"/ NULLIF(SUM(source.{denominator}){flt}, 0)")


MEASURES: list[Measure] = [
    # ---- from the metric view ------------------------------------------- #
    Measure("new_patients_filled", "new patients filled", "SUM(source.new_ptnt_filled)",
            "Total count of new patients who received a fill"),
    Measure("total_shipments", "total shipments", "SUM(source.total_shipments)",
            "Total number of shipments"),
    Measure("new_patients_written", "new patients written", "SUM(source.new_ptnt_written)",
            "Total count of new patients written (prescribed)"),
    Measure("pct_initiated_not_ft", "% Initiated_not_FT",
            _ratio("initiated_not_free_trial_therapy"),
            "Patients who initiated non-free-trial therapy / new patients written",
            "percentage", 0),
    Measure("pct_initiate_paid", "%_Initiate_Paid", _ratio("initiated_paid_therapy"),
            "Patients who initiated paid therapy / new patients written", "percentage", 1),
    Measure("pct_initiate_sp", "%_Initiate_SP", _ratio("initiated_not_free_trial_therapy"),
            "Patients who initiated SP (non-free-trial) therapy / new patients written",
            "percentage", 1),
    Measure("pct_initiate_therapy", "%_Initiate_Therapy", _ratio("initiated_therapy"),
            "Patients who initiated therapy / new patients written", "percentage", 1),
    Measure("pct_initiate_paid_exclude_ft", "%_Initiate_Paid_Exclude_FT",
            _ratio("initiated_paid_therapy", where=_PROGRAM_NOT_FT),
            "Paid initiation rate excluding blank and Free Trial programs (case-insensitive)",
            "percentage", 1),
    Measure("pct_initiate_sp_excludes_ft", "%_Initiate_SP_Excludes_FT",
            _ratio("initiated_not_free_trial_therapy", where=_PROGRAM_NOT_FT_TRIMMED),
            "Non-FT initiation rate excluding blank and Free Trial programs (trimmed, case-insensitive)",
            "percentage", 1),
    Measure("refresh_timestamp", "Refresh Date", "CURRENT_TIMESTAMP()",
            "Current timestamp at query time (Power BI NOW())", "timestamp"),
    # ---- added for the app (simple sums of existing columns) ------------- #
    Measure("initiated_therapy_count", "Initiated therapy", "SUM(source.initiated_therapy)",
            "Patients who initiated therapy (funnel stage)", origin="added"),
    Measure("initiated_not_ft_count", "Initiated non-free-trial",
            "SUM(source.initiated_not_free_trial_therapy)",
            "Patients who initiated non-free-trial therapy (funnel stage)", origin="added"),
    Measure("initiated_paid_count", "Initiated paid", "SUM(source.initiated_paid_therapy)",
            "Patients who initiated paid therapy (funnel stage)", origin="added"),
    Measure("data_refresh_date", "Data refresh date", "MAX(source.refresh_date)",
            "Latest refresh_date in the table (when the data was loaded)", "timestamp",
            origin="added"),
]


class SemanticModel:
    """Whitelist of everything the API may query. Lookups are case-insensitive
    and measures can also be referenced by their original metric-view name."""

    def __init__(self, dimensions: list[Dimension], measures: list[Measure]):
        self.dimensions = {d.name: d for d in dimensions}
        self.measures = {m.name: m for m in measures}
        self._dim_lookup = {d.name.lower(): d for d in dimensions}
        self._measure_lookup = {m.name.lower(): m for m in measures}
        self._measure_lookup.update({m.label.lower(): m for m in measures})

    def dimension(self, name: str) -> Dimension:
        dim = self._dim_lookup.get(str(name).strip().lower())
        if dim is None:
            raise QueryError(f"Unknown dimension '{name}'. See GET /api/meta for valid names.")
        return dim

    def measure(self, name: str) -> Measure:
        measure = self._measure_lookup.get(str(name).strip().lower())
        if measure is None:
            raise QueryError(f"Unknown measure '{name}'. See GET /api/meta for valid names.")
        return measure

    def period_dimension(self, basis: str, grain: str) -> Dimension:
        if basis not in DATE_BASES:
            raise QueryError(f"date_basis must be one of {list(DATE_BASES)}")
        if grain not in GRAINS:
            raise QueryError(f"grain must be one of {list(GRAINS)}")
        return self.dimension(f"{basis}_by_{grain}")

    def field_meta(self, name: str) -> dict:
        """Display metadata for a result column (used by the frontend for formatting)."""
        if name in self.measures:
            m = self.measures[name]
            return {"name": name, "label": m.label, "type": "measure",
                    "format": m.format, "decimals": m.decimals}
        if name in self.dimensions:
            d = self.dimensions[name]
            return {"name": name, "label": d.label, "type": "dimension", "format": d.kind}
        return {"name": name, "label": name, "type": "other"}

    def describe(self) -> dict:
        return {
            "dimensions": [
                {"name": d.name, "label": d.label, "kind": d.kind, "derived": d.derived}
                for d in self.dimensions.values()
            ],
            "measures": [
                {"name": m.name, "label": m.label, "description": m.description,
                 "format": m.format, "decimals": m.decimals, "origin": m.origin,
                 "expression": m.expr}
                for m in self.measures.values()
            ],
            "date_bases": list(DATE_BASES),
            "grains": list(GRAINS),
        }


MODEL = SemanticModel(_parse_dimensions(_DIMENSION_TABLE) + _period_dimensions(), MEASURES)
