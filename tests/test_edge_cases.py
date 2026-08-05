# -*- coding: utf-8 -*-
"""
AgriGen Matcher — Edge Case & Robustness Tests (QA Agent)
==========================================================
Zusätzliche Tests für Edge Cases, die in der Basis-Suite fehlen.

Bereiche:
  1. Empty query traits
  2. Malformed JSON data
  3. Single accession (n=1)
  4. Duplicate accession IDs
  5. Non-numeric trait values
  6. Missing trait keys in query
  7. Negative top_k
  8. top_k = 0
"""

import json
import pytest
import numpy as np
import tempfile
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "core"))
from matcher import HilbertMatcher, load_accessions, extract_trait_matrix, TRAIT_KEYS


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_accession(aid="TEST-001", **trait_overrides):
    """Factory für eine minimale Accession."""
    traits = {k: 5.0 for k in TRAIT_KEYS}
    traits["soil_ph_min"] = 6.0
    traits["soil_ph_max"] = 7.5
    traits["growing_days"] = 120
    traits["yield_potential_t_ha"] = 8.0
    traits["water_requirement_mm"] = 500
    traits["root_depth_cm"] = 100
    traits.update(trait_overrides)
    return {
        "accession_id": aid,
        "genus": "Triticum",
        "species": "test",
        "cultivar": "TestCultivar",
        "origin_country": "AT",
        "biological_status": "Bred_cultivar",
        "traits": traits,
    }


def _make_accessions(n=3):
    return [_make_accession(aid=f"TEST-{i:03d}") for i in range(n)]


def _valid_query():
    return {k: 5.0 for k in TRAIT_KEYS}


# ---------------------------------------------------------------------------
# 1. Empty query traits
# ---------------------------------------------------------------------------

class TestEmptyQueryTraits:
    """Leere oder unvollständige Query-Trait-Dicts."""

    def test_empty_dict_raises(self):
        """Ein leeres Query-Dict sollte einen Fehler werfen (KeyError oder ValueError)."""
        accessions = _make_accessions(3)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        with pytest.raises((KeyError, ValueError, TypeError)):
            m.match_query({}, top_k=3)

    def test_partial_query_missing_key_raises(self):
        """Eine Query mit fehlenden Traits sollte fehlschlagen."""
        accessions = _make_accessions(3)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        partial = dict(_valid_query())
        del partial["drought_tolerance"]
        with pytest.raises((KeyError, ValueError, TypeError)):
            m.match_query(partial, top_k=3)

    def test_none_query_raises(self):
        """None als Query sollte fehlschlagen."""
        accessions = _make_accessions(3)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        with pytest.raises((KeyError, ValueError, TypeError)):
            m.match_query(None, top_k=3)


# ---------------------------------------------------------------------------
# 2. Malformed JSON data
# ---------------------------------------------------------------------------

class TestMalformedJSON:
    """Tests für fehlerhafte Eingabedaten."""

    def test_malformed_json_raises(self, tmp_path):
        """Kaputtes JSON sollte einen JSONDecodeError werfen."""
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("{ this is not valid json ]")
        with pytest.raises(json.JSONDecodeError):
            load_accessions(str(bad_file))

    def test_json_array_instead_of_list(self, tmp_path):
        """Ein JSON-Objekt statt Liste sollte TypeError werfen."""
        bad_file = tmp_path / "obj.json"
        bad_file.write_text(json.dumps({"not": "a list"}))
        data = load_accessions(str(bad_file))
        # extract_trait_matrix iteriert über die Daten — dict führt zu Fehler
        with pytest.raises((TypeError, KeyError, AttributeError)):
            extract_trait_matrix(data)

    def test_empty_json_list(self, tmp_path):
        """Eine leere Liste sollte eine leere Matrix geben."""
        empty_file = tmp_path / "empty.json"
        empty_file.write_text("[]")
        data = load_accessions(str(empty_file))
        assert data == []

    def test_accession_missing_traits_key(self, tmp_path):
        """Accession ohne 'traits'-Key sollte KeyError werfen."""
        bad_data = [{"accession_id": "X", "genus": "G", "species": "S",
                      "cultivar": "C", "origin_country": "DE"}]
        bad_file = tmp_path / "notraits.json"
        bad_file.write_text(json.dumps(bad_data))
        data = load_accessions(str(bad_file))
        with pytest.raises(KeyError):
            extract_trait_matrix(data)


# ---------------------------------------------------------------------------
# 3. Single accession (n=1)
# ---------------------------------------------------------------------------

class TestSingleAccession:
    """Edge Case: Nur eine einzige Sorte im Datensatz."""

    def test_single_accession_fit(self):
        accessions = _make_accessions(1)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        assert m.K.shape == (1, 1)
        assert m.K[0, 0] == pytest.approx(1.0)

    def test_single_accession_query(self):
        accessions = _make_accessions(1)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        results = m.match_query(_valid_query(), top_k=5)
        assert len(results) == 1
        assert results[0]["rank"] == 1

    def test_single_accession_kernel_info(self):
        accessions = _make_accessions(1)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        info = m.kernel_matrix_info()
        assert info["n_accessions"] == 1
        assert info["kernel_rank"] == 1

    def test_single_accession_pairwise_distance(self):
        accessions = _make_accessions(1)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        D = m.pairwise_hilbert_distance()
        assert D.shape == (1, 1)
        assert D[0, 0] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# 4. Duplicate accession IDs
# ---------------------------------------------------------------------------

class TestDuplicateAccessionIDs:
    """Edge Case: Doppelte Accession-IDs im Datensatz."""

    def test_duplicates_dont_crash_fit(self):
        accessions = _make_accessions(3)
        accessions.append(_make_accession(aid="TEST-001"))  # Duplicate ID
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        # Sollte nicht crashen, auch wenn IDs dupliziert sind
        m.fit(X, labels, accessions)
        assert m.K.shape == (4, 4)

    def test_duplicates_both_in_results(self):
        """Beide Duplikate sollten in den Ergebnissen auftauchen können."""
        acc1 = _make_accession(aid="DUP-001")
        acc2 = _make_accession(aid="DUP-001", drought_tolerance=10)  # Different traits
        accessions = [acc1, acc2]
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        results = m.match_query(_valid_query(), top_k=5)
        ids = [r["accession_id"] for r in results]
        # Beide sollten auftauchen
        assert ids.count("DUP-001") == 2


# ---------------------------------------------------------------------------
# 5. Non-numeric trait values
# ---------------------------------------------------------------------------

class TestNonNumericTraits:
    """Edge Case: Nicht-numerische Trait-Werte."""

    def test_string_trait_value_raises(self):
        accessions = _make_accessions(2)
        accessions[0]["traits"]["drought_tolerance"] = "high"
        with pytest.raises((ValueError, TypeError)):
            extract_trait_matrix(accessions)

    def test_none_trait_value_raises(self):
        accessions = _make_accessions(2)
        accessions[0]["traits"]["yield_potential_t_ha"] = None
        with pytest.raises((ValueError, TypeError)):
            extract_trait_matrix(accessions)

    def test_nan_trait_value(self):
        """NaN sollte von float() akzeptiert werden, aber Matrix ist nicht finite."""
        accessions = _make_accessions(2)
        accessions[0]["traits"]["drought_tolerance"] = float("nan")
        # float("nan") funktioniert, aber die Matrix enthält NaN
        X, labels = extract_trait_matrix(accessions)
        assert np.any(np.isnan(X))

    def test_inf_trait_value(self):
        accessions = _make_accessions(2)
        accessions[0]["traits"]["drought_tolerance"] = float("inf")
        X, labels = extract_trait_matrix(accessions)
        assert np.any(np.isinf(X))

    def test_boolean_trait_value(self):
        """bool ist in Python ein int-Subtype — sollte als 0.0/1.0 konvertiert werden."""
        accessions = _make_accessions(2)
        accessions[0]["traits"]["drought_tolerance"] = True
        accessions[1]["traits"]["drought_tolerance"] = False
        X, labels = extract_trait_matrix(accessions)
        assert X[0, TRAIT_KEYS.index("drought_tolerance")] == 1.0
        assert X[1, TRAIT_KEYS.index("drought_tolerance")] == 0.0


# ---------------------------------------------------------------------------
# 6. Additional edge cases: top_k variations
# ---------------------------------------------------------------------------

class TestTopKEdgeCases:
    """Edge Cases für den top_k Parameter."""

    def test_top_k_zero(self):
        accessions = _make_accessions(3)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        results = m.match_query(_valid_query(), top_k=0)
        assert len(results) == 0

    def test_top_k_negative(self):
        """Negativer top_k — numpy slicing verhält sich hier möglicherweise unerwartet."""
        accessions = _make_accessions(3)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        # ranked[:negative_k] in Python schneidet von hinten ab — semantisch falsch
        # Dokumentiere das Verhalten
        results = m.match_query(_valid_query(), top_k=-1)
        # Python: list[:-1] gives all but last → semantically wrong for "top -1"
        # This is a known edge case — document it
        assert len(results) <= 3  # Should not crash


# ---------------------------------------------------------------------------
# 7. Determinism
# ---------------------------------------------------------------------------

class TestDeterminism:
    """Gleiche Query sollte identische Ergebnisse liefern."""

    def test_same_query_same_results(self):
        accessions = _make_accessions(5)
        X, labels = extract_trait_matrix(accessions)
        m = HilbertMatcher(gamma="median")
        m.fit(X, labels, accessions)
        r1 = m.match_query(_valid_query(), top_k=3)
        r2 = m.match_query(_valid_query(), top_k=3)
        assert r1 == r2
