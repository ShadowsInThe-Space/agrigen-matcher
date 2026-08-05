"""Data loading layer for AgriGen Matcher.

Provides a DataLoader interface and JSONLoader implementation.
Future: CSVLoader, APILoader, etc.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any

import numpy as np

from models import TRAIT_KEYS, Accession


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------


class DataLoader(ABC):
    """Interface for data sources providing Accession records."""

    @abstractmethod
    def load(self, source: str) -> list[Accession]:
        """Load accessions from a source path or identifier.

        Args:
            source: Path/URL/identifier understood by the implementation.

        Returns:
            List of validated Accession objects.

        Raises:
            FileNotFoundError: If source does not exist.
            ValueError: If data format is invalid.
            KeyError: If required fields are missing.
        """
        ...


# ---------------------------------------------------------------------------
# JSON implementation
# ---------------------------------------------------------------------------


class JSONLoader(DataLoader):
    """Loads Accession records from a JSON file.

    Expected format: a JSON array of objects, each with fields:
        accession_id, genus, species, cultivar, origin_country, traits

    The traits dict must contain all TRAIT_KEYS.
    """

    def load(self, source: str) -> list[Accession]:
        with open(source, "r", encoding="utf-8") as f:
            raw = json.load(f)

        if not isinstance(raw, list):
            raise TypeError(f"Expected JSON array, got {type(raw).__name__}")

        accessions: list[Accession] = []
        for i, entry in enumerate(raw):
            accessions.append(self._parse_entry(entry, i))
        return accessions

    @staticmethod
    def _parse_entry(entry: Any, index: int) -> Accession:
        """Parse and validate a single JSON entry into an Accession."""
        if not isinstance(entry, dict):
            raise TypeError(f"Entry {index} is {type(entry).__name__}, expected dict")

        required_fields = {
            "accession_id",
            "genus",
            "species",
            "cultivar",
            "origin_country",
            "traits",
        }
        missing = required_fields - set(entry.keys())
        if missing:
            raise KeyError(f"Entry {index} missing fields: {missing}")

        traits_raw = entry["traits"]
        if not isinstance(traits_raw, dict):
            raise TypeError(
                f"Entry {index} traits is {type(traits_raw).__name__}, expected dict"
            )

        # Validate all required trait keys exist and are numeric
        traits: dict[str, float] = {}
        for key in TRAIT_KEYS:
            if key not in traits_raw:
                raise KeyError(f"Entry {index} missing trait: {key}")
            val = traits_raw[key]
            if isinstance(val, bool):
                val = float(val)
            elif not isinstance(val, (int, float)):
                raise TypeError(
                    f"Entry {index} trait '{key}' is {type(val).__name__}, expected numeric"
                )
            traits[key] = float(val)

        return Accession(
            accession_id=str(entry["accession_id"]),
            genus=str(entry["genus"]),
            species=str(entry["species"]),
            cultivar=str(entry["cultivar"]),
            origin_country=str(entry["origin_country"]),
            traits=traits,
        )


# ---------------------------------------------------------------------------
# Trait matrix extraction utility
# ---------------------------------------------------------------------------


def extract_trait_matrix(accessions: list[Accession]) -> tuple[np.ndarray, list[str]]:
    """Extract a numeric trait matrix from a list of Accession objects.

    Args:
        accessions: List of Accession records with validated traits.

    Returns:
        Tuple of (X, labels) where X has shape (n_accessions, n_traits)
        and labels are human-readable identifier strings.
    """
    if not accessions:
        return np.empty((0, 0)), []

    raw: list[list[float]] = []
    labels: list[str] = []
    for acc in accessions:
        raw.append([acc.traits[k] for k in TRAIT_KEYS])
        labels.append(
            f"{acc.genus} {acc.species} — {acc.cultivar} ({acc.origin_country})"
        )

    return np.array(raw, dtype=np.float64), labels
