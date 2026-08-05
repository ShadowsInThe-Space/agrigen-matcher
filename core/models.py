"""Domain models for AgriGen Matcher.

Immutable data classes representing core business entities.
This module has zero dependencies on other core modules.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# ---------------------------------------------------------------------------
# Trait schema — single source of truth
# ---------------------------------------------------------------------------

TRAIT_KEYS: list[str] = [
    "drought_tolerance",
    "heat_tolerance",
    "cold_tolerance",
    "disease_resistance",
    "nitrogen_efficiency",
    "salinity_tolerance",
    "soil_ph_min",
    "soil_ph_max",
    "growing_days",
    "yield_potential_t_ha",
    "water_requirement_mm",
    "root_depth_cm",
]

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Accession:
    """A plant accession record from a genebank or breeding database."""

    accession_id: str
    genus: str
    species: str
    cultivar: str
    origin_country: str
    traits: dict[str, float]


@dataclass(frozen=True)
class TraitProfile:
    """A normalised trait vector used for kernel computation."""

    values: np.ndarray  # shape (n_traits,)


@dataclass(frozen=True)
class MatchResult:
    """A single ranked match entry returned by HilbertMatcher."""

    rank: int
    accession_id: str
    label: str
    match_score: float  # 0–100
    kernel_similarity: float
    accession: Accession
