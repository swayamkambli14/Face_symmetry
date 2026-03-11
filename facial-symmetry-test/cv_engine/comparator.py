"""
Comparator — computes % deviation of live scores vs baseline fingerprint.

Thresholds:
  0  - 8%  deviation -> NORMAL  (within natural noise floor)
  8  - 20% deviation -> WARNING (likely real change)
  20%+     deviation -> PROBLEM (definitive asymmetry)

Final verdict = worst status across all zones + aggregate.
"""


THRESHOLDS = {
    "NORMAL":  8.0,
    "WARNING": 20.0,
}


def get_status(deviation_pct):
    """Map deviation percentage to status string."""
    if deviation_pct < THRESHOLDS["NORMAL"]:
        return "NORMAL"
    elif deviation_pct < THRESHOLDS["WARNING"]:
        return "WARNING"
    else:
        return "PROBLEM"


STATUS_RANK = {"NORMAL": 0, "WARNING": 1, "PROBLEM": 2}


def compare(baseline_scores, live_scores):
    """
    Compare live scores against baseline fingerprint.

    Args:
        baseline_scores: dict from symmetry_engine.compute_all_scores()
        live_scores:     dict from symmetry_engine.compute_all_scores()

    Returns:
        Full result dict with per-zone breakdown + verdict.
    """
    result_zones = {}
    worst_status = "NORMAL"
    triggered_by = []

    baseline_zones = baseline_scores["zones"]
    live_zones = live_scores["zones"]

    for zone in baseline_zones:
        b_score = baseline_zones[zone]
        l_score = live_zones.get(zone, 0.0)

        if b_score == 0:
            deviation = 0.0
        else:
            deviation = round(abs(b_score - l_score) / b_score * 100, 2)

        status = get_status(deviation)

        result_zones[zone] = {
            "baseline": b_score,
            "live": l_score,
            "deviation": deviation,
            "status": status,
        }

        if STATUS_RANK[status] > STATUS_RANK[worst_status]:
            worst_status = status

        if status != "NORMAL":
            triggered_by.append(f"{zone} ({deviation}% deviation)")

    # Aggregate comparison
    b_agg = baseline_scores["aggregate"]
    l_agg = live_scores["aggregate"]

    if b_agg == 0:
        agg_deviation = 0.0
    else:
        agg_deviation = round(abs(b_agg - l_agg) / b_agg * 100, 2)

    agg_status = get_status(agg_deviation)

    if STATUS_RANK[agg_status] > STATUS_RANK[worst_status]:
        worst_status = agg_status
        triggered_by.append(f"aggregate ({agg_deviation}% deviation)")

    return {
        "zones": result_zones,
        "aggregate": {
            "baseline": b_agg,
            "live": l_agg,
            "deviation": agg_deviation,
            "status": agg_status,
        },
        "verdict": worst_status,
        "triggered_by": triggered_by if triggered_by else ["none — all within normal range"],
    }