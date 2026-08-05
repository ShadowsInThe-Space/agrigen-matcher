"""Tests for core/scaler.py — TraitScaler wrapper."""

import pytest
import numpy as np

from scaler import TraitScaler


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def X_sample():
    return np.array(
        [
            [1.0, 10.0, 100.0],
            [2.0, 20.0, 200.0],
            [3.0, 30.0, 300.0],
            [4.0, 40.0, 400.0],
        ],
        dtype=np.float64,
    )


# ---------------------------------------------------------------------------
# Constructor validation
# ---------------------------------------------------------------------------


class TestTraitScalerConstruction:
    def test_default_strategy_is_standard(self):
        s = TraitScaler()
        assert s._strategy == "standard"

    def test_invalid_strategy_raises(self):
        with pytest.raises(ValueError):
            TraitScaler(strategy="bogus")


# ---------------------------------------------------------------------------
# standard strategy
# ---------------------------------------------------------------------------


class TestStandardStrategy:
    def test_fit_transform_shape(self, X_sample):
        s = TraitScaler(strategy="standard")
        Xs = s.fit_transform(X_sample)
        assert Xs.shape == X_sample.shape

    def test_zero_mean_after_fit(self, X_sample):
        s = TraitScaler(strategy="standard")
        Xs = s.fit_transform(X_sample)
        assert np.allclose(Xs.mean(axis=0), 0.0, atol=1e-10)

    def test_unit_std_after_fit(self, X_sample):
        s = TraitScaler(strategy="standard")
        Xs = s.fit_transform(X_sample)
        assert np.allclose(Xs.std(axis=0), 1.0, atol=1e-10)

    def test_transform_uses_fit_params(self, X_sample):
        s = TraitScaler(strategy="standard")
        s.fit_transform(X_sample)
        Y = np.array([[5.0, 50.0, 500.0]])
        Yt = s.transform(Y)
        # Manual standardisation using X_sample stats
        means = X_sample.mean(axis=0)
        stds = X_sample.std(axis=0)
        expected = (Y - means) / stds
        assert np.allclose(Yt, expected)

    def test_transform_without_fit_raises(self, X_sample):
        s = TraitScaler(strategy="standard")
        with pytest.raises(Exception):
            s.transform(X_sample)


# ---------------------------------------------------------------------------
# none strategy (identity)
# ---------------------------------------------------------------------------


class TestNoneStrategy:
    def test_none_returns_copy(self, X_sample):
        s = TraitScaler(strategy="none")
        Xs = s.fit_transform(X_sample)
        assert np.array_equal(Xs, X_sample)

    def test_none_transform_identity(self, X_sample):
        s = TraitScaler(strategy="none")
        s.fit_transform(X_sample)
        Y = np.array([[99.0, 99.0, 99.0]])
        Yt = s.transform(Y)
        assert np.array_equal(Yt, Y)

    def test_none_returns_independent_copy(self, X_sample):
        """Mutating the output must not affect the input."""
        s = TraitScaler(strategy="none")
        Xs = s.fit_transform(X_sample)
        Xs[0, 0] = -999.0
        assert X_sample[0, 0] != -999.0
