"""Kernel strategies for AgriGen Matcher.

Provides the KernelStrategy interface and RBFKernel implementation.
Future: PolynomialKernel, LaplacianKernel, etc.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np
from sklearn.metrics.pairwise import rbf_kernel
from scipy.spatial.distance import pdist


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------

class KernelStrategy(ABC):
    """Interface for kernel functions in Hilbert space.

    A kernel strategy computes K(X, Y) — the similarity matrix between
    two sets of vectors in a reproducing kernel Hilbert space (RKHS).
    """

    @abstractmethod
    def fit(self, X: np.ndarray) -> None:
        """Initialise kernel parameters (e.g. gamma heuristic) from training data."""
        ...

    @abstractmethod
    def compute(self, X: np.ndarray, Y: np.ndarray | None = None) -> np.ndarray:
        """Compute kernel matrix K(X, Y). If Y is None, compute K(X, X).

        Args:
            X: Training data, shape (n_samples_x, n_features).
            Y: Query data, shape (n_samples_y, n_features). If None, Y = X.

        Returns:
            Kernel matrix of shape (n_samples_x, n_samples_y).
        """
        ...

    @property
    @abstractmethod
    def gamma_value(self) -> float:
        """The resolved gamma parameter. Raises if not fitted."""
        ...


# ---------------------------------------------------------------------------
# RBF Kernel implementation
# ---------------------------------------------------------------------------

class RBFKernel(KernelStrategy):
    """RBF (Gaussian) kernel: K(x, y) = exp(-gamma * ||x - y||²).

    Gamma strategies:
        "auto"   → 1 / (n_features * var(X))
        "median" → 1 / median(pairwise squared distances)  [recommended]
        float    → explicit value
    """

    def __init__(self, gamma: str | float = "median") -> None:
        self._gamma_spec: str | float = gamma
        self._gamma_val: float | None = None

    def fit(self, X: np.ndarray) -> None:
        n_samples = X.shape[0]
        n_features = X.shape[1]

        if isinstance(self._gamma_spec, str):
            if self._gamma_spec == "auto":
                variance = X.var()
                if variance < 1e-15:
                    self._gamma_val = 1.0
                else:
                    self._gamma_val = 1.0 / (n_features * variance)
            elif self._gamma_spec == "median":
                # Median heuristic needs at least 2 samples for pairwise distances
                if n_samples < 2:
                    self._gamma_val = 1.0
                else:
                    sq_dists = pdist(X, "sqeuclidean")
                    median_sq = np.median(sq_dists)
                    self._gamma_val = 1.0 / (median_sq + 1e-10)
            else:
                raise ValueError(
                    f"Unknown gamma strategy '{self._gamma_spec}'. "
                    "Use 'auto', 'median', or a float."
                )
        else:
            self._gamma_val = float(self._gamma_spec)

    def compute(self, X: np.ndarray, Y: np.ndarray | None = None) -> np.ndarray:
        if self._gamma_val is None:
            raise RuntimeError("Kernel not fitted. Call fit() before compute().")
        return rbf_kernel(X, Y, gamma=self._gamma_val)

    @property
    def gamma_value(self) -> float:
        if self._gamma_val is None:
            raise RuntimeError("Kernel not fitted. Call fit() before accessing gamma_value.")
        return self._gamma_val
