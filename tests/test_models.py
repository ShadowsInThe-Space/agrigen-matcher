"""Tests for core/models.py — Domain data classes."""

import dataclasses

import pytest
import numpy as np

from models import TRAIT_KEYS, Accession, TraitProfile, MatchResult


class TestTraitKeys:
    def test_trait_keys_count(self):
        assert len(TRAIT_KEYS) == 12

    def test_trait_keys_order_stable(self):
        expected = [
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
        assert TRAIT_KEYS == expected


class TestAccession:
    def _make(self):
        return Accession(
            accession_id="EUR-001",
            genus="Triticum",
            species="aestivum",
            cultivar="Wintergold",
            origin_country="Germany",
            traits={k: 5.0 for k in TRAIT_KEYS},
        )

    def test_accession_creation(self):
        acc = self._make()
        assert acc.accession_id == "EUR-001"
        assert acc.genus == "Triticum"
        assert acc.cultivar == "Wintergold"

    def test_accession_immutable(self):
        acc = self._make()
        with pytest.raises(dataclasses.FrozenInstanceError):
            acc.genus = "Zea"

    def test_accession_traits_dict(self):
        acc = self._make()
        assert len(acc.traits) == 12
        for key in TRAIT_KEYS:
            assert key in acc.traits


class TestTraitProfile:
    def test_values_shape(self):
        tp = TraitProfile(values=np.zeros(12))
        assert tp.values.shape == (12,)

    def test_immutable(self):
        tp = TraitProfile(values=np.zeros(12))
        with pytest.raises(dataclasses.FrozenInstanceError):
            tp.values = np.ones(12)


class TestMatchResult:
    def _make_accession(self):
        return Accession(
            accession_id="X",
            genus="G",
            species="S",
            cultivar="C",
            origin_country="DE",
            traits={k: 0.0 for k in TRAIT_KEYS},
        )

    def test_match_result_fields(self):
        mr = MatchResult(
            rank=1,
            accession_id="X",
            label="Test",
            match_score=95.5,
            kernel_similarity=0.987,
            accession=self._make_accession(),
        )
        assert mr.rank == 1
        assert mr.match_score == 95.5
        assert mr.accession.genus == "G"

    def test_immutable(self):
        mr = MatchResult(
            rank=1,
            accession_id="X",
            label="T",
            match_score=1.0,
            kernel_similarity=0.5,
            accession=self._make_accession(),
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            mr.rank = 2
