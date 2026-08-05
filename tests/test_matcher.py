# AgriGen Matcher — Test Suite
#
# TDD System: Jede neue Funktion bekommt zuerst einen Test.
# Lauf: `pytest tests/ -v --cov=core --cov-report=term-missing`

import json
import pytest
import numpy as np
import sys
import os

# core-Modul auf den Pfad legen
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "core"))
from matcher import (
    HilbertMatcher,
    load_accessions,
    extract_trait_matrix,
    TRAIT_KEYS,
    DATA_PATH,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_data_path():
    return DATA_PATH


@pytest.fixture
def accessions(sample_data_path):
    return load_accessions(sample_data_path)


@pytest.fixture
def trait_matrix(accessions):
    X, labels = extract_trait_matrix(accessions)
    return X, labels


@pytest.fixture
def fitted_matcher(trait_matrix, accessions):
    X, labels = trait_matrix
    m = HilbertMatcher(gamma="median")
    m.fit(X, labels, accessions)
    return m


@pytest.fixture
def valid_query():
    return {
        "drought_tolerance": 8,
        "heat_tolerance": 7,
        "cold_tolerance": 5,
        "disease_resistance": 7,
        "nitrogen_efficiency": 7,
        "salinity_tolerance": 5,
        "soil_ph_min": 6.0,
        "soil_ph_max": 7.5,
        "growing_days": 130,
        "yield_potential_t_ha": 8.0,
        "water_requirement_mm": 500,
        "root_depth_cm": 150,
    }


# ---------------------------------------------------------------------------
# Daten-Laden
# ---------------------------------------------------------------------------

class TestDataLoading:
    """Tests für Daten-Integrität."""

    def test_loads_all_accessions(self, accessions):
        assert len(accessions) == 12

    def test_each_accession_has_required_fields(self, accessions):
        required = {"accession_id", "genus", "species", "cultivar", "origin_country", "traits"}
        for acc in accessions:
            missing = required - set(acc.keys())
            assert not missing, f"Missing fields in {acc.get('accession_id')}: {missing}"

    def test_each_accession_has_all_traits(self, accessions):
        for acc in accessions:
            missing = set(TRAIT_KEYS) - set(acc["traits"].keys())
            assert not missing, f"Missing traits in {acc['accession_id']}: {missing}"

    def test_trait_values_are_numeric(self, accessions):
        for acc in accessions:
            for key, val in acc["traits"].items():
                assert isinstance(val, (int, float)), \
                    f"{acc['accession_id']}.{key} is {type(val)}, not numeric"

    def test_tolerance_values_in_valid_range(self, accessions):
        tolerance_keys = {"drought_tolerance", "heat_tolerance", "cold_tolerance",
                          "disease_resistance", "nitrogen_efficiency", "salinity_tolerance"}
        for acc in accessions:
            for key in tolerance_keys:
                val = acc["traits"][key]
                assert 0 <= val <= 10, \
                    f"{acc['accession_id']}.{key} = {val}, expected 0-10"


# ---------------------------------------------------------------------------
# Trait-Matrix-Extraktion
# ---------------------------------------------------------------------------

class TestTraitMatrix:
    """Tests für Feature-Extraktion."""

    def test_matrix_shape(self, trait_matrix):
        X, _ = trait_matrix
        assert X.shape == (12, 12)  # 12 accessions × 12 traits

    def test_labels_count_matches_rows(self, trait_matrix):
        X, labels = trait_matrix
        assert len(labels) == X.shape[0]

    def test_matrix_is_finite(self, trait_matrix):
        X, _ = trait_matrix
        assert np.all(np.isfinite(X)), "Matrix contains NaN or Inf"

    def test_matrix_has_variance(self, trait_matrix):
        """Keine degenerierte Spalten (alle Werte identisch)."""
        X, _ = trait_matrix
        col_stds = X.std(axis=0)
        zero_var_cols = np.where(col_stds < 1e-10)[0]
        assert len(zero_var_cols) == 0, \
            f"Zero-variance columns at indices: {zero_var_cols}"


# ---------------------------------------------------------------------------
# HilbertMatcher — Fit
# ---------------------------------------------------------------------------

class TestMatcherFit:
    """Tests für die Kernel-Matrix-Konstruktion."""

    def test_kernel_matrix_shape(self, fitted_matcher):
        assert fitted_matcher.K.shape == (12, 12)

    def test_kernel_matrix_is_symmetric(self, fitted_matcher):
        K = fitted_matcher.K
        assert np.allclose(K, K.T), "Kernel matrix is not symmetric"

    def test_kernel_diagonal_is_one(self, fitted_matcher):
        """RBF-Kernel: K(x,x) = exp(0) = 1 für alle x."""
        diag = np.diag(fitted_matcher.K)
        assert np.allclose(diag, 1.0), f"Diagonal = {diag}, expected all 1.0"

    def test_kernel_values_in_unit_interval(self, fitted_matcher):
        """RBF-Kernel-Werte sind in [0, 1]."""
        K = fitted_matcher.K
        assert K.min() >= 0.0 - 1e-10
        assert K.max() <= 1.0 + 1e-10

    def test_gamma_is_positive(self, fitted_matcher):
        assert fitted_matcher._gamma_value > 0

    def test_gamma_median_heuristic(self, trait_matrix):
        """Median-Heuristik sollte einen plausiblen gamma-Wert liefern."""
        X, _ = trait_matrix
        m = HilbertMatcher(gamma="median")
        m.fit(X, ["label"] * 12, [])
        assert 0 < m._gamma_value < 10  # für normalisierte Daten typisch

    def test_kernel_matrix_full_rank(self, fitted_matcher):
        """Bei 12 verschiedenen Accessionen sollte die Kernel-Matrix vollen Rang haben."""
        rank = np.linalg.matrix_rank(fitted_matcher.K)
        assert rank == 12, f"Kernel rank = {rank}, expected 12"


# ---------------------------------------------------------------------------
# HilbertMatcher — Query / Matching
# ---------------------------------------------------------------------------

class TestMatcherQuery:
    """Tests für die Match-Logik."""

    def test_returns_top_k_results(self, fitted_matcher, valid_query):
        results = fitted_matcher.match_query(valid_query, top_k=5)
        assert len(results) == 5

    def test_results_are_sorted_by_score_desc(self, fitted_matcher, valid_query):
        results = fitted_matcher.match_query(valid_query, top_k=5)
        scores = [r["match_score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_top_result_has_highest_score(self, fitted_matcher, valid_query):
        results = fitted_matcher.match_query(valid_query, top_k=5)
        assert results[0]["match_score"] >= results[-1]["match_score"]

    def test_match_scores_between_0_and_100(self, fitted_matcher, valid_query):
        results = fitted_matcher.match_query(valid_query, top_k=12)
        for r in results:
            assert 0 <= r["match_score"] <= 100

    def test_self_match_is_near_100(self, fitted_matcher, accessions):
        """Eine Sorte sollte sich selbst mit ~100% matchen."""
        acc = accessions[0]
        query = acc["traits"]
        results = fitted_matcher.match_query(query, top_k=12)
        top = results[0]
        assert top["accession_id"] == acc["accession_id"]
        assert top["match_score"] > 99.0, f"Self-match score = {top['match_score']}, expected >99"

    def test_result_has_required_fields(self, fitted_matcher, valid_query):
        results = fitted_matcher.match_query(valid_query, top_k=1)
        required = {"rank", "accession_id", "label", "match_score",
                    "kernel_similarity", "genus", "species", "cultivar",
                    "origin", "traits"}
        assert required.issubset(set(results[0].keys()))

    def test_rank_starts_at_1(self, fitted_matcher, valid_query):
        results = fitted_matcher.match_query(valid_query, top_k=5)
        assert results[0]["rank"] == 1


# ---------------------------------------------------------------------------
# Semantische Korrektheit
# ---------------------------------------------------------------------------

class TestSemanticCorrectness:
    """Tests ob das Matching inhaltlich plausible Ergebnisse liefert."""

    def test_drought_query_finds_drought_tolerant(self, fitted_matcher):
        """Eine Dürre/Hitze-Query sollte DesertKing oder DryMax-7 oben finden."""
        query = {
            "drought_tolerance": 10, "heat_tolerance": 10, "cold_tolerance": 2,
            "disease_resistance": 6, "nitrogen_efficiency": 6, "salinity_tolerance": 7,
            "soil_ph_min": 5.5, "soil_ph_max": 8.5, "growing_days": 110,
            "yield_potential_t_ha": 8.0, "water_requirement_mm": 350, "root_depth_cm": 200,
        }
        results = fitted_matcher.match_query(query, top_k=3)
        top_ids = {r["accession_id"] for r in results}
        assert "EUR-006" in top_ids or "EUR-002" in top_ids, \
            f"Expected DesertKing or DryMax-7 in top 3, got {top_ids}"

    def test_cold_query_finds_cold_tolerant(self, fitted_matcher):
        """Eine Kälte-Query sollte Nordstern oder FrostShield oben finden."""
        query = {
            "drought_tolerance": 3, "heat_tolerance": 2, "cold_tolerance": 10,
            "disease_resistance": 8, "nitrogen_efficiency": 7, "salinity_tolerance": 4,
            "soil_ph_min": 5.8, "soil_ph_max": 7.5, "growing_days": 155,
            "yield_potential_t_ha": 7.0, "water_requirement_mm": 580, "root_depth_cm": 90,
        }
        results = fitted_matcher.match_query(query, top_k=3)
        top_ids = {r["accession_id"] for r in results}
        assert "EUR-003" in top_ids or "EUR-008" in top_ids, \
            f"Expected Nordstern or FrostShield in top 3, got {top_ids}"

    def test_opposite_profiles_have_low_scores(self, fitted_matcher, accessions):
        """DesertKing sollte nicht zu einer Kälte-Query passen."""
        cold_query = {
            "drought_tolerance": 2, "heat_tolerance": 2, "cold_tolerance": 10,
            "disease_resistance": 8, "nitrogen_efficiency": 7, "salinity_tolerance": 3,
            "soil_ph_min": 6.0, "soil_ph_max": 7.5, "growing_days": 160,
            "yield_potential_t_ha": 7.0, "water_requirement_mm": 600, "root_depth_cm": 85,
        }
        results = fitted_matcher.match_query(cold_query, top_k=12)
        desert_king = [r for r in results if r["accession_id"] == "EUR-006"]
        assert desert_king[0]["rank"] > 5, \
            f"DesertKing ranked #{desert_king[0]['rank']} for cold query, expected >5"


# ---------------------------------------------------------------------------
# Hilbert-Raum-Metriken
# ---------------------------------------------------------------------------

class TestHilbertMetrics:
    """Tests für die Kernel-Matrix-Metadaten."""

    def test_kernel_matrix_info_has_fields(self, fitted_matcher):
        info = fitted_matcher.kernel_matrix_info()
        required = {"n_accessions", "gamma", "kernel_rank", "kernel_trace",
                    "kernel_det", "frobenius_norm"}
        assert required.issubset(set(info.keys()))

    def test_kernel_trace_equals_n(self, fitted_matcher):
        """Spur der RBF-Kernel-Matrix = n (da alle Diagonalen = 1)."""
        info = fitted_matcher.kernel_matrix_info()
        assert abs(info["kernel_trace"] - 12.0) < 0.01

    def test_pairwise_hilbert_distance_shape(self, fitted_matcher):
        D = fitted_matcher.pairwise_hilbert_distance()
        assert D.shape == (12, 12)

    def test_pairwise_distance_diagonal_is_zero(self, fitted_matcher):
        D = fitted_matcher.pairwise_hilbert_distance()
        assert np.allclose(np.diag(D), 0.0)

    def test_pairwise_distance_symmetric(self, fitted_matcher):
        D = fitted_matcher.pairwise_hilbert_distance()
        assert np.allclose(D, D.T)


# ---------------------------------------------------------------------------
# Edge Cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    """Tests für Grenzfälle."""

    def test_top_k_larger_than_dataset(self, fitted_matcher, valid_query):
        results = fitted_matcher.match_query(valid_query, top_k=100)
        assert len(results) == 12  # gibt nur 12 Accessionen

    def test_top_k_one(self, fitted_matcher, valid_query):
        results = fitted_matcher.match_query(valid_query, top_k=1)
        assert len(results) == 1

    def test_extreme_query_all_zeros(self, fitted_matcher):
        """Query mit allen Nullen sollte nicht crashen."""
        query = {k: 0.0 for k in TRAIT_KEYS}
        results = fitted_matcher.match_query(query, top_k=3)
        assert len(results) == 3

    def test_extreme_query_all_tens(self, fitted_matcher):
        """Query mit allen Zehnen sollte nicht crashen."""
        tolerance_keys = [k for k in TRAIT_KEYS if k.endswith("_tolerance") or k.endswith("_efficiency")]
        query = {}
        for k in TRAIT_KEYS:
            if k in tolerance_keys:
                query[k] = 10
            elif k == "soil_ph_min":
                query[k] = 5.0
            elif k == "soil_ph_max":
                query[k] = 9.0
            elif k == "yield_potential_t_ha":
                query[k] = 100.0
            elif k == "growing_days":
                query[k] = 300
            elif k == "water_requirement_mm":
                query[k] = 200
            elif k == "root_depth_cm":
                query[k] = 300
        results = fitted_matcher.match_query(query, top_k=3)
        assert len(results) == 3
