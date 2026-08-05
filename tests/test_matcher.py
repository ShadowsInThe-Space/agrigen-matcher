"""Tests for core/matcher.py — HilbertMatcher orchestrator (DI-based).

Unit tests with mock collaborators + integration tests with real
RBFKernel and TraitScaler.
"""

import pytest
import numpy as np

from kernel import RBFKernel
from matcher import HilbertMatcher
from models import TRAIT_KEYS, Accession, MatchResult, TraitProfile
from scaler import TraitScaler

# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

import os

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "sample_eurisco.json")


def _make_accession(aid: str = "X", **trait_overrides) -> Accession:
    traits = {k: 5.0 for k in TRAIT_KEYS}
    traits["soil_ph_min"] = 6.0
    traits["soil_ph_max"] = 7.5
    traits["growing_days"] = 120
    traits["yield_potential_t_ha"] = 8.0
    traits["water_requirement_mm"] = 500
    traits["root_depth_cm"] = 100
    traits.update(trait_overrides)
    return Accession(
        accession_id=aid,
        genus="Triticum",
        species="test",
        cultivar="TestCv",
        origin_country="AT",
        traits=traits,
    )


def _make_accessions(n: int = 3) -> list[Accession]:
    return [_make_accession(aid=f"ACC-{i:03d}") for i in range(n)]


def _valid_query_dict() -> dict[str, float]:
    return {k: 5.0 for k in TRAIT_KEYS}


def _load_real_accessions() -> list[Accession]:
    from data_loader import JSONLoader
    return JSONLoader().load(DATA_PATH)


@pytest.fixture
def real_accessions():
    return _load_real_accessions()


@pytest.fixture
def fitted_matcher(real_accessions):
    """Integration fixture: real RBFKernel + real TraitScaler on sample data."""
    m = HilbertMatcher(
        kernel=RBFKernel(gamma="median"),
        scaler=TraitScaler(strategy="standard"),
    )
    m.fit(real_accessions)
    return m


# ---------------------------------------------------------------------------
# Construction & DI
# ---------------------------------------------------------------------------

class TestDependencyInjection:
    def test_accepts_kernel_and_scaler(self):
        m = HilbertMatcher(
            kernel=RBFKernel(),
            scaler=TraitScaler(),
        )
        assert m is not None

    def test_not_fitted_before_fit_call(self):
        m = HilbertMatcher(kernel=RBFKernel(), scaler=TraitScaler())
        with pytest.raises(RuntimeError):
            m.kernel_info()
        with pytest.raises(RuntimeError):
            m.hilbert_distances()
        with pytest.raises(RuntimeError):
            m.match(_valid_query_dict())


# ---------------------------------------------------------------------------
# Fit
# ---------------------------------------------------------------------------

class TestFit:
    def test_fit_returns_self(self, real_accessions):
        m = HilbertMatcher(kernel=RBFKernel(), scaler=TraitScaler())
        result = m.fit(real_accessions)
        assert result is m

    def test_fit_empty_list_raises(self):
        m = HilbertMatcher(kernel=RBFKernel(), scaler=TraitScaler())
        with pytest.raises(ValueError):
            m.fit([])

    def test_fit_computes_kernel_matrix(self, fitted_matcher):
        assert fitted_matcher._K is not None
        assert fitted_matcher._K.shape == (12, 12)

    def test_fit_kernel_symmetric(self, fitted_matcher):
        K = fitted_matcher._K
        assert np.allclose(K, K.T)

    def test_fit_kernel_diagonal_one(self, fitted_matcher):
        assert np.allclose(np.diag(fitted_matcher._K), 1.0)

    def test_fit_kernel_values_in_01(self, fitted_matcher):
        K = fitted_matcher._K
        assert K.min() >= -1e-10
        assert K.max() <= 1.0 + 1e-10

    def test_fit_kernel_full_rank(self, fitted_matcher):
        rank = np.linalg.matrix_rank(fitted_matcher._K)
        assert rank == 12


# ---------------------------------------------------------------------------
# Match — return type & ranking
# ---------------------------------------------------------------------------

class TestMatchResults:
    def test_returns_match_result_objects(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query_dict(), top_k=3)
        for r in results:
            assert isinstance(r, MatchResult)

    def test_top_k_count(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query_dict(), top_k=5)
        assert len(results) == 5

    def test_top_k_one(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query_dict(), top_k=1)
        assert len(results) == 1

    def test_top_k_larger_than_dataset(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query_dict(), top_k=100)
        assert len(results) == 12

    def test_top_k_zero(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query_dict(), top_k=0)
        assert len(results) == 0

    def test_sorted_by_score_desc(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query_dict(), top_k=5)
        scores = [r.match_score for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_rank_starts_at_1(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query_dict(), top_k=3)
        assert results[0].rank == 1
        assert results[1].rank == 2

    def test_scores_between_0_and_100(self, fitted_matcher):
        results = fitted_matcher.match(_valid_query_dict(), top_k=12)
        for r in results:
            assert 0 <= r.match_score <= 100

    def test_self_match_near_100(self, fitted_matcher, real_accessions):
        """An accession queried with its own traits should score ~100."""
        acc = real_accessions[0]
        results = fitted_matcher.match(acc.traits, top_k=12)
        assert results[0].accession_id == acc.accession_id
        assert results[0].match_score > 99.0


# ---------------------------------------------------------------------------
# Query validation (the known bug fix)
# ---------------------------------------------------------------------------

class TestQueryValidation:
    def test_missing_trait_raises_keyerror(self, fitted_matcher):
        partial = _valid_query_dict()
        del partial["drought_tolerance"]
        with pytest.raises(KeyError):
            fitted_matcher.match(partial)

    def test_empty_dict_raises(self, fitted_matcher):
        with pytest.raises(KeyError):
            fitted_matcher.match({})

    def test_none_query_raises(self, fitted_matcher):
        with pytest.raises(TypeError):
            fitted_matcher.match(None)  # type: ignore[arg-type]

    def test_wrong_type_raises(self, fitted_matcher):
        with pytest.raises(TypeError):
            fitted_matcher.match([1, 2, 3])  # type: ignore[arg-type]

    def test_trait_profile_accepted(self, fitted_matcher):
        vals = np.array([5.0] * 12, dtype=np.float64)
        tp = TraitProfile(values=vals)
        results = fitted_matcher.match(tp, top_k=3)
        assert len(results) == 3


# ---------------------------------------------------------------------------
# n=1 edge case (the known bug fix)
# ---------------------------------------------------------------------------

class TestSingleAccessionFit:
    def test_single_accession_no_nan(self):
        accs = [_make_accession(aid="SOLO")]
        m = HilbertMatcher(
            kernel=RBFKernel(gamma="median"),
            scaler=TraitScaler(),
        )
        m.fit(accs)
        assert np.isfinite(m._K).all()
        assert m._K.shape == (1, 1)
        assert m._K[0, 0] == pytest.approx(1.0)

    def test_single_accession_match(self):
        accs = [_make_accession(aid="SOLO")]
        m = HilbertMatcher(
            kernel=RBFKernel(gamma="median"),
            scaler=TraitScaler(),
        )
        m.fit(accs)
        results = m.match(_valid_query_dict(), top_k=5)
        assert len(results) == 1
        assert results[0].rank == 1
        assert results[0].accession_id == "SOLO"

    def test_single_accession_kernel_info(self):
        accs = [_make_accession(aid="SOLO")]
        m = HilbertMatcher(
            kernel=RBFKernel(gamma="median"),
            scaler=TraitScaler(),
        )
        m.fit(accs)
        info = m.kernel_info()
        assert info["n_accessions"] == 1
        assert info["kernel_rank"] == 1

    def test_single_accession_hilbert_distance(self):
        accs = [_make_accession(aid="SOLO")]
        m = HilbertMatcher(
            kernel=RBFKernel(gamma="median"),
            scaler=TraitScaler(),
        )
        m.fit(accs)
        D = m.hilbert_distances()
        assert D.shape == (1, 1)
        assert D[0, 0] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Semantic correctness (integration tests)
# ---------------------------------------------------------------------------

class TestSemanticCorrectness:
    def test_drought_query_finds_drought_tolerant(self, fitted_matcher):
        """Drought/heat query should rank DesertKing or DryMax-7 in top 3."""
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

    def test_opposite_profile_ranks_low(self, fitted_matcher):
        """DesertKing should not rank high for a cold query."""
        cold_query = {
            "drought_tolerance": 2, "heat_tolerance": 2, "cold_tolerance": 10,
            "disease_resistance": 8, "nitrogen_efficiency": 7, "salinity_tolerance": 3,
            "soil_ph_min": 6.0, "soil_ph_max": 7.5, "growing_days": 160,
            "yield_potential_t_ha": 7.0, "water_requirement_mm": 600, "root_depth_cm": 85,
        }
        results = fitted_matcher.match(cold_query, top_k=12)
        desert_king = [r for r in results if r.accession_id == "EUR-006"]
        assert desert_king[0].rank > 5


# ---------------------------------------------------------------------------
# Kernel metadata
# ---------------------------------------------------------------------------

class TestKernelMetadata:
    def test_kernel_info_fields(self, fitted_matcher):
        info = fitted_matcher.kernel_info()
        required = {
            "n_accessions", "gamma", "kernel_rank",
            "kernel_trace", "kernel_det", "frobenius_norm",
        }
        assert required.issubset(set(info.keys()))

    def test_kernel_trace_equals_n(self, fitted_matcher):
        info = fitted_matcher.kernel_info()
        assert abs(info["kernel_trace"] - 12.0) < 0.01

    def test_hilbert_distances_shape(self, fitted_matcher):
        D = fitted_matcher.hilbert_distances()
        assert D.shape == (12, 12)

    def test_hilbert_distances_diagonal_zero(self, fitted_matcher):
        D = fitted_matcher.hilbert_distances()
        assert np.allclose(np.diag(D), 0.0)

    def test_hilbert_distances_symmetric(self, fitted_matcher):
        D = fitted_matcher.hilbert_distances()
        assert np.allclose(D, D.T)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

class TestDeterminism:
    def test_same_query_same_results(self, fitted_matcher):
        r1 = fitted_matcher.match(_valid_query_dict(), top_k=5)
        r2 = fitted_matcher.match(_valid_query_dict(), top_k=5)
        assert r1 == r2


# ---------------------------------------------------------------------------
# Extreme queries don't crash
# ---------------------------------------------------------------------------

class TestExtremeQueries:
    def test_all_zeros(self, fitted_matcher):
        query = {k: 0.0 for k in TRAIT_KEYS}
        results = fitted_matcher.match(query, top_k=3)
        assert len(results) == 3

    def test_all_max(self, fitted_matcher):
        query = {k: 10.0 for k in TRAIT_KEYS}
        results = fitted_matcher.match(query, top_k=3)
        assert len(results) == 3
