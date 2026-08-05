"""Tests for core/data_loader.py — DataLoader interface + JSONLoader."""

import json

import pytest
import numpy as np

from models import TRAIT_KEYS, Accession
from data_loader import DataLoader, JSONLoader, extract_trait_matrix

import os
DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "sample_eurisco.json")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def loader():
    return JSONLoader()


@pytest.fixture
def sample_path():
    return DATA_PATH


@pytest.fixture
def loaded_accessions(loader, sample_path):
    return loader.load(sample_path)


# ---------------------------------------------------------------------------
# DataLoader interface
# ---------------------------------------------------------------------------

class TestDataLoaderInterface:
    def test_is_abstract(self):
        """DataLoader should not be directly instantiable."""
        with pytest.raises(TypeError):
            DataLoader()

    def test_json_loader_is_data_loader(self, loader):
        assert isinstance(loader, DataLoader)


# ---------------------------------------------------------------------------
# JSONLoader — happy path
# ---------------------------------------------------------------------------

class TestJSONLoaderHappyPath:
    def test_loads_all_accessions(self, loaded_accessions):
        assert len(loaded_accessions) == 12

    def test_returns_accession_instances(self, loaded_accessions):
        for acc in loaded_accessions:
            assert isinstance(acc, Accession)

    def test_accession_fields_populated(self, loaded_accessions):
        acc = loaded_accessions[0]
        assert acc.accession_id
        assert acc.genus
        assert acc.species
        assert acc.cultivar
        assert acc.origin_country
        assert len(acc.traits) == 12

    def test_all_trait_keys_present(self, loaded_accessions):
        for acc in loaded_accessions:
            for key in TRAIT_KEYS:
                assert key in acc.traits, f"{acc.accession_id} missing {key}"

    def test_trait_values_numeric(self, loaded_accessions):
        for acc in loaded_accessions:
            for key, val in acc.traits.items():
                assert isinstance(val, (int, float)), \
                    f"{acc.accession_id}.{key} is {type(val)}"


# ---------------------------------------------------------------------------
# JSONLoader — error cases
# ---------------------------------------------------------------------------

class TestJSONLoaderErrors:
    def test_missing_file(self, loader):
        with pytest.raises(FileNotFoundError):
            loader.load("/nonexistent/path.json")

    def test_malformed_json(self, loader, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text("{ broken json ]")
        with pytest.raises(json.JSONDecodeError):
            loader.load(str(bad))

    def test_not_a_list(self, loader, tmp_path):
        f = tmp_path / "obj.json"
        f.write_text(json.dumps({"not": "a list"}))
        with pytest.raises((TypeError, ValueError, KeyError)):
            loader.load(str(f))

    def test_empty_list(self, loader, tmp_path):
        f = tmp_path / "empty.json"
        f.write_text("[]")
        result = loader.load(str(f))
        assert result == []

    def test_accession_missing_traits_key(self, loader, tmp_path):
        bad_data = [{"accession_id": "X", "genus": "G", "species": "S",
                      "cultivar": "C", "origin_country": "DE"}]
        f = tmp_path / "notraits.json"
        f.write_text(json.dumps(bad_data))
        with pytest.raises(KeyError):
            loader.load(str(f))

    def test_accession_missing_trait_key(self, loader, tmp_path):
        """Accession missing one of TRAIT_KEYS in traits dict."""
        traits = {k: 5.0 for k in TRAIT_KEYS}
        del traits["drought_tolerance"]
        bad_data = [{"accession_id": "X", "genus": "G", "species": "S",
                      "cultivar": "C", "origin_country": "DE",
                      "traits": traits}]
        f = tmp_path / "missingtrait.json"
        f.write_text(json.dumps(bad_data))
        with pytest.raises(KeyError):
            loader.load(str(f))


# ---------------------------------------------------------------------------
# extract_trait_matrix utility
# ---------------------------------------------------------------------------

class TestExtractTraitMatrix:
    def test_matrix_shape(self, loaded_accessions):
        X, labels = extract_trait_matrix(loaded_accessions)
        assert X.shape == (12, 12)

    def test_labels_count(self, loaded_accessions):
        X, labels = extract_trait_matrix(loaded_accessions)
        assert len(labels) == 12

    def test_matrix_finite(self, loaded_accessions):
        X, _ = extract_trait_matrix(loaded_accessions)
        assert np.all(np.isfinite(X))

    def test_matrix_has_variance(self, loaded_accessions):
        X, _ = extract_trait_matrix(loaded_accessions)
        assert np.all(X.std(axis=0) > 1e-10)

    def test_label_format(self, loaded_accessions):
        _, labels = extract_trait_matrix(loaded_accessions)
        assert "Triticum" in labels[0] or "EUR-001" in labels[0] or "Wintergold" in labels[0]

    def test_empty_input(self):
        X, labels = extract_trait_matrix([])
        assert X.shape == (0, 0) or len(X) == 0

    def test_non_numeric_trait_raises(self):
        # Build a raw dict with non-numeric trait value
        # JSONLoader should raise on non-numeric trait
        with pytest.raises((ValueError, TypeError)):
            raw = [{"accession_id": "X", "genus": "G", "species": "S",
                    "cultivar": "C", "origin_country": "DE",
                    "traits": {**{k: 5.0 for k in TRAIT_KEYS}, "drought_tolerance": "high"}}]
            # Write temp JSON and try loading
            import tempfile
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
                json.dump(raw, f)
                f.flush()
                loader = JSONLoader()
                loader.load(f.name)
