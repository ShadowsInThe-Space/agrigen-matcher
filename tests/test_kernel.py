"""Tests for core/kernel.py — KernelStrategy interface + RBFKernel."""

import pytest
import numpy as np
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "core"))
from kernel import KernelStrategy, RBFKernel


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def X_small():
    """3 samples × 4 features."""
    return np.array([
        [1.0, 2.0, 3.0, 4.0],
        [5.0, 6.0, 7.0, 8.0],
        [1.1, 2.1, 3.1, 4.1],
    ], dtype=np.float64)


@pytest.fixture
def Y_query():
    """1 × 4 query vector."""
    return np.array([[1.05, 2.05, 3.05, 4.05]], dtype=np.float64)


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------

class TestKernelInterface:
    def test_is_abstract(self):
        with pytest.raises(TypeError):
            KernelStrategy()

    def test_rbf_is_kernel_strategy(self):
        k = RBFKernel()
        assert isinstance(k, KernelStrategy)


# ---------------------------------------------------------------------------
# RBFKernel — fit + compute
# ---------------------------------------------------------------------------

class TestRBFKernelFitCompute:
    def test_matrix_shape_square(self, X_small):
        k = RBFKernel(gamma="median")
        k.fit(X_small)
        K = k.compute(X_small)
        assert K.shape == (3, 3)

    def test_symmetric(self, X_small):
        k = RBFKernel(gamma="median")
        k.fit(X_small)
        K = k.compute(X_small)
        assert np.allclose(K, K.T)

    def test_diagonal_one(self, X_small):
        """RBF: K(x,x) = exp(0) = 1."""
        k = RBFKernel(gamma="median")
        k.fit(X_small)
        K = k.compute(X_small)
        assert np.allclose(np.diag(K), 1.0)

    def test_values_in_01(self, X_small):
        k = RBFKernel(gamma="median")
        k.fit(X_small)
        K = k.compute(X_small)
        assert K.min() >= -1e-10
        assert K.max() <= 1.0 + 1e-10


# ---------------------------------------------------------------------------
# Gamma strategies
# ---------------------------------------------------------------------------

class TestGammaStrategies:
    def test_gamma_auto_positive(self, X_small):
        k = RBFKernel(gamma="auto")
        k.fit(X_small)
        assert k.gamma_value > 0

    def test_gamma_median_positive(self, X_small):
        k = RBFKernel(gamma="median")
        k.fit(X_small)
        assert k.gamma_value > 0

    def test_gamma_explicit(self, X_small):
        k = RBFKernel(gamma=0.5)
        k.fit(X_small)
        assert k.gamma_value == pytest.approx(0.5)

    def test_gamma_auto_formula(self, X_small):
        """auto = 1 / (n_features * var(X))."""
        k = RBFKernel(gamma="auto")
        k.fit(X_small)
        expected = 1.0 / (4.0 * X_small.var())
        assert k.gamma_value == pytest.approx(expected)

    def test_gamma_median_formula(self, X_small):
        """median = 1 / (median(pairwise_sq_dist) + epsilon)."""
        from scipy.spatial.distance import pdist
        k = RBFKernel(gamma="median")
        k.fit(X_small)
        sq_dists = pdist(X_small, "sqeuclidean")
        expected = 1.0 / (np.median(sq_dists) + 1e-10)
        assert k.gamma_value == pytest.approx(expected)

    def test_gamma_not_set_before_fit(self):
        k = RBFKernel(gamma="median")
        with pytest.raises((ValueError, RuntimeError)):
            _ = k.gamma_value


# ---------------------------------------------------------------------------
# Query (cross-kernel) computation
# ---------------------------------------------------------------------------

class TestRBFKernelQuery:
    def test_query_shape(self, X_small, Y_query):
        k = RBFKernel(gamma="median")
        k.fit(X_small)
        K_q = k.compute(X_small, Y_query)
        assert K_q.shape == (3, 1) or K_q.shape == (1, 3)

    def test_query_values_in_01(self, X_small, Y_query):
        k = RBFKernel(gamma="median")
        k.fit(X_small)
        K_q = k.compute(X_small, Y_query)
        assert K_q.min() >= -1e-10
        assert K_q.max() <= 1.0 + 1e-10

    def test_self_query_is_one(self, X_small):
        """K(x, x) for a query == 1."""
        k = RBFKernel(gamma="median")
        k.fit(X_small)
        K_q = k.compute(X_small, X_small[:1])
        assert K_q[0, 0] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# n=1 edge case (the bug we're fixing from the start)
# ---------------------------------------------------------------------------

class TestRBFKernelSingleSample:
    def test_fit_single_sample_does_not_nan(self):
        X = np.array([[1.0, 2.0, 3.0, 4.0]])
        k = RBFKernel(gamma="median")
        k.fit(X)
        assert np.isfinite(k.gamma_value)
        assert k.gamma_value > 0

    def test_compute_single_sample(self):
        X = np.array([[1.0, 2.0, 3.0, 4.0]])
        k = RBFKernel(gamma="median")
        k.fit(X)
        K = k.compute(X)
        assert K.shape == (1, 1)
        assert K[0, 0] == pytest.approx(1.0)
