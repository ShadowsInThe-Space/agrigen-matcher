"""Edge case & robustness tests — rewritten for the SOLID DI-based API."""

import json
import pytest
import numpy as np

from data_loader import JSONLoader
from kernel import RBFKernel
from matcher import HilbertMatcher
from models import TRAIT_KEYS, Accession, MatchResult
from scaler import TraitScaler


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_accession(aid: str = "TEST-001", **trait_overrides) -> Accession:
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
    return [_make_accession(aid=f"TEST-{i:03d}") for i in range(n)]


def _valid_query() -> dict[str, float]:
    return {k: 5.0 for k in TRAIT_KEYS}


def _build_matcher(accessions: list[Accession]) -> HilbertMatcher:
    m = HilbertMatcher(
        kernel=RBFKernel(gamma="median"),
        scaler=TraitScaler(),
    )
    m.fit(accessions)
    return m


# ---------------------------------------------------------------------------
# Query validation
# ---------------------------------------------------------------------------


class TestQueryValidation:
    def test_empty_dict_raises(self):
        m = _build_matcher(_make_accessions(3))
        with pytest.raises(KeyError):
            m.match({})

    def test_partial_query_missing_key_raises(self):
        m = _build_matcher(_make_accessions(3))
        partial = _valid_query()
        del partial["drought_tolerance"]
        with pytest.raises(KeyError):
            m.match(partial)

    def test_none_query_raises(self):
        m = _build_matcher(_make_accessions(3))
        with pytest.raises(TypeError):
            m.match(None)  # type: ignore[arg-type]

    def test_list_query_raises(self):
        m = _build_matcher(_make_accessions(3))
        with pytest.raises(TypeError):
            m.match([1, 2, 3])  # type: ignore[arg-type]

    def test_all_missing_traits_listed_in_error(self):
        """Error message should list ALL missing keys, not just the first."""
        m = _build_matcher(_make_accessions(3))
        with pytest.raises(KeyError) as exc_info:
            m.match({"drought_tolerance": 5.0})
        error_str = str(exc_info.value)
        assert "heat_tolerance" in error_str
        assert "cold_tolerance" in error_str


# ---------------------------------------------------------------------------
# JSONLoader robustness
# ---------------------------------------------------------------------------


class TestJSONLoaderRobustness:
    def test_malformed_json_raises(self, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text("{ broken json ]")
        with pytest.raises(json.JSONDecodeError):
            JSONLoader().load(str(bad))

    def test_object_not_list_raises(self, tmp_path):
        f = tmp_path / "obj.json"
        f.write_text(json.dumps({"not": "a list"}))
        with pytest.raises(TypeError):
            JSONLoader().load(str(f))

    def test_empty_list_returns_empty(self, tmp_path):
        f = tmp_path / "empty.json"
        f.write_text("[]")
        result = JSONLoader().load(str(f))
        assert result == []

    def test_entry_missing_traits_raises(self, tmp_path):
        bad_data = [
            {
                "accession_id": "X",
                "genus": "G",
                "species": "S",
                "cultivar": "C",
                "origin_country": "DE",
            }
        ]
        f = tmp_path / "notraits.json"
        f.write_text(json.dumps(bad_data))
        with pytest.raises(KeyError):
            JSONLoader().load(str(f))

    def test_entry_missing_single_trait_raises(self, tmp_path):
        traits = {k: 5.0 for k in TRAIT_KEYS}
        del traits["drought_tolerance"]
        bad_data = [
            {
                "accession_id": "X",
                "genus": "G",
                "species": "S",
                "cultivar": "C",
                "origin_country": "DE",
                "traits": traits,
            }
        ]
        f = tmp_path / "missing.json"
        f.write_text(json.dumps(bad_data))
        with pytest.raises(KeyError):
            JSONLoader().load(str(f))


# ---------------------------------------------------------------------------
# Single accession (n=1 bug fix)
# ---------------------------------------------------------------------------


class TestSingleAccession:
    def test_fit_single_no_nan(self):
        m = _build_matcher([_make_accession(aid="SOLO")])
        assert np.isfinite(m._K).all()

    def test_fit_single_kernel_shape(self):
        m = _build_matcher([_make_accession(aid="SOLO")])
        assert m._K.shape == (1, 1)

    def test_match_single(self):
        m = _build_matcher([_make_accession(aid="SOLO")])
        results = m.match(_valid_query(), top_k=5)
        assert len(results) == 1

    def test_match_single_rank_one(self):
        m = _build_matcher([_make_accession(aid="SOLO")])
        results = m.match(_valid_query(), top_k=5)
        assert results[0].rank == 1

    def test_kernel_info_single(self):
        m = _build_matcher([_make_accession(aid="SOLO")])
        info = m.kernel_info()
        assert info["n_accessions"] == 1
        assert info["kernel_rank"] == 1

    def test_hilbert_distance_single(self):
        m = _build_matcher([_make_accession(aid="SOLO")])
        D = m.hilbert_distances()
        assert D.shape == (1, 1)
        assert D[0, 0] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Duplicate accession IDs
# ---------------------------------------------------------------------------


class TestDuplicateAccessionIDs:
    def test_duplicates_dont_crash(self):
        accs = _make_accessions(3)
        accs.append(_make_accession(aid="TEST-000"))
        m = _build_matcher(accs)
        assert m._K.shape == (4, 4)

    def test_duplicates_both_in_results(self):
        acc1 = _make_accession(aid="DUP-001", drought_tolerance=5.0)
        acc2 = _make_accession(aid="DUP-001", drought_tolerance=10.0)
        m = _build_matcher([acc1, acc2])
        results = m.match(_valid_query(), top_k=5)
        ids = [r.accession_id for r in results]
        assert ids.count("DUP-001") == 2


# ---------------------------------------------------------------------------
# Non-numeric trait values (at loader level)
# ---------------------------------------------------------------------------


class TestNonNumericTraits:
    def test_string_trait_rejected_by_loader(self, tmp_path):
        traits = {k: 5.0 for k in TRAIT_KEYS}
        traits["drought_tolerance"] = "high"
        bad_data = [
            {
                "accession_id": "X",
                "genus": "G",
                "species": "S",
                "cultivar": "C",
                "origin_country": "DE",
                "traits": traits,
            }
        ]
        f = tmp_path / "bad.json"
        f.write_text(json.dumps(bad_data))
        with pytest.raises(TypeError):
            JSONLoader().load(str(f))

    def test_none_trait_rejected_by_loader(self, tmp_path):
        traits = {k: 5.0 for k in TRAIT_KEYS}
        traits["drought_tolerance"] = None
        bad_data = [
            {
                "accession_id": "X",
                "genus": "G",
                "species": "S",
                "cultivar": "C",
                "origin_country": "DE",
                "traits": traits,
            }
        ]
        f = tmp_path / "bad.json"
        f.write_text(json.dumps(bad_data))
        with pytest.raises(TypeError):
            JSONLoader().load(str(f))


# ---------------------------------------------------------------------------
# top_k edge cases
# ---------------------------------------------------------------------------


class TestTopKEdgeCases:
    def test_top_k_zero(self):
        m = _build_matcher(_make_accessions(3))
        results = m.match(_valid_query(), top_k=0)
        assert len(results) == 0

    def test_top_k_negative(self):
        """Negative top_k should return 0 results (guarded by max())."""
        m = _build_matcher(_make_accessions(3))
        results = m.match(_valid_query(), top_k=-1)
        assert len(results) == 0


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


class TestDeterminism:
    def test_same_query_same_results(self):
        m = _build_matcher(_make_accessions(5))
        r1 = m.match(_valid_query(), top_k=3)
        r2 = m.match(_valid_query(), top_k=3)
        assert r1 == r2


# ---------------------------------------------------------------------------
# MatchResult immutability
# ---------------------------------------------------------------------------


class TestMatchResultImmutable:
    def test_cannot_mutate_rank(self):
        import dataclasses

        mr = MatchResult(
            rank=1,
            accession_id="X",
            label="L",
            match_score=1.0,
            kernel_similarity=0.5,
            accession=_make_accession(),
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            mr.rank = 99
