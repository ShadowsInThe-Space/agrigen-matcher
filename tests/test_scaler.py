"""Tests for core/scaler.py — TraitScaler."""

import pytest
import numpy as np
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "core"))
from scaler import TraitScaler


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def X_train():
    """4 samples × 3 features, varying ranges."""
    return np.array([
        [1.0, 100.0, 0.5],
        [2.0, 200.0, 1.5],
        [3.0, 300.0, 2.5],
        [4.0, 400.0, 3.5],
    ], dtype=np.float64)


@pytest.fixture
def X_query(X_train):
    return np.array([[2.5, 250.0, 2.0]], dtype=np.float64)


# ---------------------------------------------------------------------------
# fit_transform
# ---------------------------------------------------------------------------

class TestFitTransform:
    def test_output_shape_matches_input(self, X_train):
        s = TraitScaler()
        Xs = s.fit_transform(X_train)
        assert Xs.shape == X_train.shape

    def test_zero_mean(self, X_train):
        s = TraitScaler()
        Xs = s.fit_transform(X_train)
        means = Xs.mean(axis=0)
        assert np.allclose(means, 0.0, atol=1e-10)

    def test_unit_std(self, X_train):
        s = TraitScaler()
        Xs = s.fit_transform(X_train)
        stds = Xs.std(axis=0)
        assert np.allclose(stds, 1.0, atol=1e-10)

    def test_finite_output(self, X_train):
        s = TraitScaler()
        Xs = s.fit_transform(X_train)
        assert np.all(np.isfinite(Xs))


# ---------------------------------------------------------------------------
# transform (after fit)
# ---------------------------------------------------------------------------

class TestTransform:
    def test_transform_uses_fitted_params(self, X_train, X_query):
        s = TraitScaler()
        s.fit_transform(X_train)
        Xq = s.transform(X_query)
        assert Xq.shape == X_query.shape

    def test_transform_is_consistent(self, X_train):
        """transform(fit_transform(X)) == fit_transform(X)."""
        s = TraitScaler()
        Xs = s.fit_transform(X_train)
        Xs2 = s.transform(X_train)
        assert np.allclose(Xs, Xs2)

    def test_transform_new_data(self, X_train):
        """Transform should apply same scaling to new data."""
        s = TraitScaler()
        Xs = s.fit_transform(X_train)

        # A point equal to the training mean → scaled to 0
        mean_row = X_train.mean(axis=0, keepdims=True)
        scaled_mean = s.transform(mean_row)
        assert np.allclose(scaled_mean, 0.0, atol=1e-10)


# ---------------------------------------------------------------------------
# Strategy "none"
# ---------------------------------------------------------------------------

class TestStrategyNone:
    def test_none_is_identity(self, X_train):
        s = TraitScaler(strategy="none")
        Xs = s.fit_transform(X_train)
        assert np.allclose(Xs, X_train)

    def test_none_transform(self, X_train, X_query):
        s = TraitScaler(strategy="none")
        s.fit_transform(X_train)
        Xq = s.transform(X_query)
        assert np.allclose(Xq, X_query)


# ---------------------------------------------------------------------------
# Invalid strategy
# ---------------------------------------------------------------------------

class TestInvalidStrategy:
    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            TraitScaler(strategy="bogus")
