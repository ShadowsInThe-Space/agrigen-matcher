"""Terminal demo for AgriGen Matcher.

Presentation layer only — no math, no data parsing.
All business logic is delegated to matcher, data_loader, and models.
"""

from __future__ import annotations

import os

from matcher import HilbertMatcher
from kernel import RBFKernel
from scaler import TraitScaler
from data_loader import JSONLoader
from models import MatchResult

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "sample_eurisco.json")


def print_banner() -> None:
    print("=" * 68)
    print("  AgriGen Matcher — RBF-Kernel Sorten-Empfehlung im Hilbert-Raum")
    print("  Proof of Concept · KI Biennale Award 2026")
    print("=" * 68)
    print()


def print_kernel_info(matcher: HilbertMatcher) -> None:
    info = matcher.kernel_info()
    print("── Kernel-Matrix (Hilbert-Raum) ──────────────────────────")
    print(f"  Accessionen im Raum:    {info['n_accessions']}")
    print(f"  RBF gamma:              {info['gamma']}")
    print(f"  Rang der Kernel-Matrix: {info['kernel_rank']} (von {info['n_accessions']})")
    print(f"  Spur (Trace):           {info['kernel_trace']}")
    print(f"  Frobenius-Norm:         {info['frobenius_norm']}")
    print("  → Vollständige Hilbert-Raum-Repräsentation aktiv")
    print()


def print_results(results: list[MatchResult], query_name: str) -> None:
    print(f"── Top Matches für: {query_name} ──────────────────────────")
    print()

    print(f"  {'#':<3} {'Score':>6}  {'Sorte':<45} {'Herkunft':<12}")
    print(f"  {'─'*3} {'─'*6}  {'─'*45} {'─'*12}")

    for r in results:
        sorte = f"{r.accession.genus} {r.accession.species} — {r.accession.cultivar}"
        if len(sorte) > 45:
            sorte = sorte[:42] + "..."
        print(f"  {r.rank:<3} {r.match_score:>5.1f}%  {sorte:<45} {r.accession.origin_country:<12}")

    print()

    top = results[0]
    print(f"  ★ Top-Match Detail: {top.accession.cultivar}")
    print(f"    Match-Score (RKHS Cosine): {top.match_score:.2f}%")
    print(f"    Kernel-Ähnlichkeit (K(x,y)): {top.kernel_similarity:.6f}")
    print("    Trait-Profil:")
    for k, v in top.accession.traits.items():
        print(f"      {k:<25} {v}")
    print()


def _build_matcher() -> HilbertMatcher:
    loader = JSONLoader()
    accessions = loader.load(DATA_PATH)
    matcher = HilbertMatcher(
        kernel=RBFKernel(gamma="median"),
        scaler=TraitScaler(strategy="standard"),
    )
    matcher.fit(accessions)
    return matcher


_SCENARIOS = [
    {
        "name": "Szenario A: Dürre-resistente Sorte für Südeuropa",
        "traits": {
            "drought_tolerance": 9, "heat_tolerance": 9, "cold_tolerance": 3,
            "disease_resistance": 6, "nitrogen_efficiency": 6, "salinity_tolerance": 7,
            "soil_ph_min": 5.8, "soil_ph_max": 8.0, "growing_days": 120,
            "yield_potential_t_ha": 10.0, "water_requirement_mm": 400, "root_depth_cm": 180,
        },
    },
    {
        "name": "Szenario B: Kälte-resistente Sorte für Nordeuropa",
        "traits": {
            "drought_tolerance": 4, "heat_tolerance": 3, "cold_tolerance": 10,
            "disease_resistance": 8, "nitrogen_efficiency": 7, "salinity_tolerance": 4,
            "soil_ph_min": 5.8, "soil_ph_max": 7.5, "growing_days": 155,
            "yield_potential_t_ha": 7.5, "water_requirement_mm": 580, "root_depth_cm": 95,
        },
    },
    {
        "name": "Szenario C: N-fixierende, wasser-effiziente Sorte",
        "traits": {
            "drought_tolerance": 7, "heat_tolerance": 6, "cold_tolerance": 6,
            "disease_resistance": 6, "nitrogen_efficiency": 10, "salinity_tolerance": 5,
            "soil_ph_min": 5.8, "soil_ph_max": 7.5, "growing_days": 110,
            "yield_potential_t_ha": 4.0, "water_requirement_mm": 400, "root_depth_cm": 120,
        },
    },
]


def run_demo() -> None:
    """Run the full terminal demo: load data, fit matcher, run scenarios."""
    print_banner()

    matcher = _build_matcher()

    print(f"Lade {len(matcher.accessions)} Accessionen aus EURISCO-Musterdaten...")
    print()

    print_kernel_info(matcher)

    for scenario in _SCENARIOS:
        results = matcher.match(scenario["traits"], top_k=5)
        print_results(results, scenario["name"])

    print("=" * 68)
    print("  PoC abgeschlossen. Engine bereit für API/UI-Integration.")
    print("=" * 68)


if __name__ == "__main__":
    run_demo()
