"""Kernel strategies for Hilbert-space projection.

The RBF (Gaussian) kernel maps trait vectors into a Reproducing Kernel
Hilbert Space (RKHS), where functional similarity between varieties
can be measured.

New kernel types (Polynomial, Laplacian, Linear) can be added by
implementing ``KernelStrategy`` — no existing code needs to change.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np
from scipy.spatial.distance import pdist
from sklearn.metrics.pairwise import rbf_kernel


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------


class KernelStrategy(ABC):
    """Strategy interface for kernel computation in Hilbert space."""

    @abstractmethod
    def fit(self, X: np.ndarray) -> None:
        """Compute internal parameters (e.g. gamma) from training data."""
        ...

    @abstractmethod
    def compute(self, X: np.ndarray, Y: np.ndarray | None = None) -> np.ndarray:
        """Kernel matrix K(X, Y).  If Y is None, compute K(X, X)."""
        ...

    @property
    @abstractmethod
    def gamma_value(self) -> float:
        """The resolved gamma scalar (available after fit)."""
        ...


# ---------------------------------------------------------------------------
# RBF Kernel implementation
# ---------------------------------------------------------------------------


class RBFKernel(KernelStrategy):
    """RBF (Gaussian) kernel with pluggable gamma heuristics.

    K(x, y) = exp(-gamma * ||x - y||^2)

    Gamma strategies
    ----------------
    ``"auto"``
        1 / (n_features * variance(X))  — sklearn-compatible.
    ``"median"``
        1 / (median(pairwise_sq_dist) + eps)  — recommended heuristic [1].

    [1] Schölkopf & Smola (2002), *Learning with Kernels*.
    """

    def __init__(self, gamma: str | float = "median") -> None:
        self._gamma_param = gamma
        self._gamma_val: float | None = None

    # -- public API --------------------------------------------------------

    def fit(self, X: np.ndarray) -> None:
        """Resolve the gamma value from training data."""
        if X.ndim != 2:
            raise ValueError(f"Expected 2-D array, got {X.ndim}-D")

        if isinstance(self._gamma_param, str):
            if self._gamma_param == "auto":
                self._gamma_val = self._gamma_auto(X)
            elif self._gamma_param == "median":
                self._gamma_val = self._gamma_median(X)
            else:
                raise ValueError(
                    f"Unknown gamma strategy '{self._gamma_param}'. "
                    "Use 'auto', 'median', or a float."
                )
        else:
            self._gamma_val = float(self._gamma_param)

    def compute(self, X: np.ndarray, Y: np.ndarray | None = None) -> np.ndarray:
        if self._gamma_val is None:
            raise RuntimeError("Kernel not fitted. Call fit() first.")
        if Y is None:
            return rbf_kernel(X, gamma=self._gamma_val)
        return rbf_kernel(X, Y, gamma=self._gamma_val)

    @property
    def gamma_value(self) -> float:
        if self._gamma_val is None:
            raise RuntimeError("Kernel not fitted. Call fit() first.")
        return self._gamma_val

    # -- gamma heuristics --------------------------------------------------

    @staticmethod
    def _gamma_auto(X: np.ndarray) -> float:
        """1 / (n_features * var(X)) — sklearn 'auto' formula."""
        return 1.0 / (X.shape[1] * X.var())

    @staticmethod
    def _gamma_median(X: np.ndarray) -> float:
        """1 / (median pairwise squared distance + epsilon).

        Guards against the n=1 case where pdist returns an empty array:
        falls back to gamma = 1.0 so the kernel is still computable.
        """
        if X.shape[0] < 2:
            return 1.0
        sq_dists = pdist(X, "sqeuclidean")
        median_sq = float(np.median(sq_dists))
        return 1.0 / (median_sq + 1e-10)
