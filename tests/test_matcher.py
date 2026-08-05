"""Tests for core/matcher.py — HilbertMatcher as pure orchestrator."""

import pytest
import numpy as np
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "core"))
from models import TRAIT_KEYS, Accession, MatchResult
from kernel import RBFKernel
from scaler import TraitScaler
from data_loader import JSONLoader, extract_trait_matrix
from matcher import HilbertMatcher

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "sample_eurisco.json")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_accession(aid="TEST-001", **overrides):
    traits = {k: 5.0 for k in TRAIT_KEYS}
    traits["soil_ph_min"] = 6.0
    traits["soil_ph_max"] = 7.5
    traits["growing_days"] = 120
    traits["yield_potential_t_ha"] = 8.0
    traits["water_requirement_mm"] = 500
    traits["root_depth_cm"] = 100
    traits.update(overrides)
    return Accession(
        accession_id=aid, genus="Triticum", species="test",
        cultivar="TestCultivar", origin_country="AT", traits=traits,
    )


def _make_accessions(n=3):
    return [_make_accession(aid=f"TEST-{i:03d}") for i in range(n)]


def _valid_query():
    return {k: 5.0 for k in TRAIT_KEYS}


@pytest.fixture
def loader():
    return JSONLoader()


@pytest.fixture
def real_accessions(loader):
    return loader.load(DATA_PATH)


@pytest.fixture
def real_X_labels(real_accessions):
    return extract_trait_matrix(real_accessions)


@pytest.fixture
def matcher():
    """Fresh matcher with real RBFKernel + TraitScaler."""
    return HilbertMatcher(
        kernel=RBFKernel(gamma="median"),
        scaler=TraitScaler(strategy="standard"),
    )


@pytest.fixture
def fitted_matcher(matcher, real_accessions):
    matcher.fit(real_accessions)
    return matcher


@pytest.fixture
def synthetic_fitted():
    """Matcher fitted on 3 synthetic accessions."""
    accessions = _make_accessions(3)
    m = HilbertMatcher(
        kernel=RBFKernel(gamma="median"),
        scaler=TraitScaler(strategy="standard"),
    )
    m.fit(accessions)
    return m, accessions


# ---------------------------------------------------------------------------
# Construction / DI
# ---------------------------------------------------------------------------

class TestConstruction:
    def test_accepts_injected_kernel_and_scaler(self):
        k = RBFKernel(gamma=0.5)
        s = TraitScaler()
        m = HilbertMatcher(kernel=k, scaler=s)
        assert m is not None

    def test_not_fitted_before_fit_called(self):
        m = HilbertMatcher(
            kernel=RBFKernel(gamma=0.5),
            scaler=TraitScaler(),
        )
        with pytest.raises(RuntimeError):
            m.match(_valid_query())
        with pytest.raises(RuntimeError):
            m.kernel_info()


# ---------------------------------------------------------------------------
# Fit
# ---------------------------------------------------------------------------

class TestFit:
    def test_fit_returns_self(self, matcher, real_accessions):
        result = matcher.fit(real_accessions)
        assert result is matcher

    def test_fit_stores_accessions(self, matcher, real_accessions):
        matcher.fit(real_accessions)
        assert len(matcher.accessions) == 12

    def test_fit_computes_kernel_matrix(self, matcher, real_accessions):
        matcher.fit(real_accessions)
        assert matcher.K is not None
        assert matcher.K.shape == (12, 12)

    def test_kernel_matrix_symmetric(self, fitted_matcher):
        K = fitted_matcher.K
        assert np.allclose(K, K.T)

    def test_kernel_diagonal_one(self, fitted_matcher):
        assert np.allclose(np.diag(fitted_matcher.K), 1.0)

    def test_kernel_values_01(self, fitted_matcher):
        K = fitted_matcher.K
        assert K.min() >= -1e-10
        assert K.max() <= 1.0 + 1e-10

    def test_gamma_positive(self, fitted_matcher):
        assert fitted_matcher._kernel.gamma_value > 0

    def test_fit_single_accession(self):
        """n=1 should not crash (the bug we're preventing)."""
        accs = [_make_accession()]
        m = HilbertMatcher(
            kernel=RBFKernel(gamma="median"),
            scaler=TraitScaler(),
        )
        m.fit(accs)
        assert m.K.shape == (1, 1)
        assert m.K[0, 0] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Match / Query
# ---------------------------------------------------------------------------

class TestMatch:
    def test_returns_list_of_match_result(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query(), top_k=5)
        assert len(results) == 5
        for r in results:
            assert isinstance(r, MatchResult)

    def test_results_sorted_by_score_desc(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query(), top_k=5)
        scores = [r.match_score for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_rank_starts_at_1(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query(), top_k=3)
        assert results[0].rank == 1
        assert results[1].rank == 2

    def test_scores_0_to_100(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query(), top_k=12)
        for r in results:
            assert 0 <= r.match_score <= 100

    def test_self_match_near_100(self, fitted_matcher, real_accessions):
        acc = real_accessions[0]
        results = fitted_matcher.match(acc.traits, top_k=12)
        assert results[0].accession_id == acc.accession_id
        assert results[0].match_score > 99.0

    def test_top_k_clamped(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query(), top_k=100)
        assert len(results) == 12

    def test_top_k_one(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query(), top_k=1)
        assert len(results) == 1

    def test_top_k_zero(self, synthetic_fitted):
        m, _ = synthetic_fitted
        results = m.match(_valid_query(), top_k=0)
        assert len(results) == 0

    def test_match_result_has_accession_ref(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query(), top_k=1)
        acc = results[0].accession
        assert isinstance(acc, Accession)
        assert acc.genus
        assert acc.traits


# ---------------------------------------------------------------------------
# Kernel info / Hilbert distances
# ---------------------------------------------------------------------------

class TestKernelInfo:
    def test_kernel_info_fields(self, fitted_matcher):
        info = fitted_matcher.kernel_info()
        required = {"n_accessions", "gamma", "kernel_rank", "kernel_trace",
                    "kernel_det", "frobenius_norm"}
        assert required.issubset(set(info.keys()))

    def test_kernel_trace_equals_n(self, fitted_matcher):
        info = fitted_matcher.kernel_info()
        assert abs(info["kernel_trace"] - 12.0) < 0.01

    def test_hilbert_distance_shape(self, fitted_matcher):
        D = fitted_matcher.hilbert_distances()
        assert D.shape == (12, 12)

    def test_hilbert_distance_diagonal_zero(self, fitted_matcher):
        D = fitted_matcher.hilbert_distances()
        assert np.allclose(np.diag(D), 0.0)

    def test_hilbert_distance_symmetric(self, fitted_matcher):
        D = fitted_matcher.hilbert_distances()
        assert np.allclose(D, D.T)


# ---------------------------------------------------------------------------
# Semantic correctness (integration with real data)
# ---------------------------------------------------------------------------

class TestSemanticCorrectness:
    def test_drought_query_finds_drought_tolerant(self, fitted_matcher):
        query = {
            "drought_tolerance": 10, "heat_tolerance": 10, "cold_tolerance": 2,
            "disease_resistance": 6, "nitrogen_efficiency": 6, "salinity_tolerance": 7,
            "soil_ph_min": 5.5, "soil_ph_max": 8.5, "growing_days": 110,
            "yield_potential_t_ha": 8.0, "water_requirement_mm": 350, "root_depth_cm": 200,
        }
        results = fitted_matcher.match(query, top_k=3)
        top_ids = {r.accession_id for r in results}
        assert "EUR-006" in top_ids or "EUR-002" in top_ids

    def test_cold_query_finds_cold_tolerant(self, fitted_matcher):
        query = {
            "drought_tolerance": 3, "heat_tolerance": 2, "cold_tolerance": 10,
            "disease_resistance": 8, "nitrogen_efficiency": 7, "salinity_tolerance": 4,
            "soil_ph_min": 5.8, "soil_ph_max": 7.5, "growing_days": 155,
            "yield_potential_t_ha": 7.0, "water_requirement_mm": 580, "root_depth_cm": 90,
        }
        results = fitted_matcher.match(query, top_k=3)
        top_ids = {r.accession_id for r in results}
        assert "EUR-003" in top_ids or "EUR-008" in top_ids

    def test_opposite_profiles_low_rank(self, fitted_matcher):
        cold_query = {
            "drought_tolerance": 2, "heat_tolerance": 2, "cold_tolerance": 10,
            "disease_resistance": 8, "nitrogen_efficiency": 7, "salinity_tolerance": 3,
            "soil_ph_min": 6.0, "soil_ph_max": 7.5, "growing_days": 160,
            "yield_potential_t_ha": 7.0, "water_requirement_mm": 600, "root_depth_cm": 85,
        }
        results = fitted_matcher.match(cold_query, top_k=12)
        desert = [r for r in results if r.accession_id == "EUR-006"]
        assert desert[0].rank > 5


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

class TestDeterminism:
    def test_same_query_same_results(self, fitted_matcher):
        q = _valid_query()
        r1 = fitted_matcher.match(q, top_k=5)
        r2 = fitted_matcher.match(q, top_k=5)
        assert r1 == r2


# ---------------------------------------------------------------------------
# n=1 edge case
# ---------------------------------------------------------------------------

class TestSingleAccession:
    def test_fit_and_match_single(self):
        accs = [_make_accession()]
        m = HilbertMatcher(
            kernel=RBFKernel(gamma="median"),
            scaler=TraitScaler(),
        )
        m.fit(accs)
        results = m.match(_valid_query(), top_k=5)
        assert len(results) == 1
        assert results[0].rank == 1

    def test_single_kernel_info(self):
        accs = [_make_accession()]
        m = HilbertMatcher(
            kernel=RBFKernel(gamma="median"),
            scaler=TraitScaler(),
        )
        m.fit(accs)
        info = m.kernel_info()
        assert info["n_accessions"] == 1
        assert info["kernel_rank"] == 1

    def test_single_hilbert_distance(self):
        accs = [_make_accession()]
        m = HilbertMatcher(
            kernel=RBFKernel(gamma="median"),
            scaler=TraitScaler(),
        )
        m.fit(accs)
        D = m.hilbert_distances()
        assert D.shape == (1, 1)
        assert D[0, 0] == pytest.approx(0.0)
