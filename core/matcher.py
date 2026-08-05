"""HilbertMatcher — pure orchestrator for the AgriGen matching pipeline.

Coordinates: scale → kernel → rank. All computation is delegated to
injected KernelStrategy and TraitScaler dependencies (DIP).
"""

from __future__ import annotations

from typing import Any

import numpy as np

from models import TRAIT_KEYS, Accession, MatchResult, TraitProfile
from kernel import KernelStrategy, RBFKernel
from scaler import TraitScaler


class HilbertMatcher:
    """Orchestrates the RKHS-based matching pipeline.

    Dependencies are injected via the constructor (DIP):
        kernel: computes RBF similarity matrices
        scaler: normalises trait vectors

    The matcher itself contains NO sklearn/scipy calls.
    """

    def __init__(
        self,
        kernel: KernelStrategy | None = None,
        scaler: TraitScaler | None = None,
    ) -> None:
        self._kernel: KernelStrategy = kernel or RBFKernel(gamma="median")
        self._scaler: TraitScaler = scaler or TraitScaler(strategy="standard")
        self._accessions: list[Accession] = []
        self._labels: list[str] = []
        self._X_scaled: np.ndarray | None = None
        self._K: np.ndarray | None = None
        self._fitted: bool = False

    # ------------------------------------------------------------------
    # Properties (read-only)
    # ------------------------------------------------------------------

    @property
    def accessions(self) -> list[Accession]:
        return self._accessions

    @property
    def K(self) -> np.ndarray | None:
        return self._K

    @property
    def _kernel_internal(self) -> KernelStrategy:
        """Expose kernel for testing gamma_value."""
        return self._kernel

    # ------------------------------------------------------------------
    # Fit
    # ------------------------------------------------------------------

    def fit(self, accessions: list[Accession]) -> "HilbertMatcher":
        """Fit the matcher: scale traits, compute kernel matrix.

        Args:
            accessions: List of Accession records to match against.

        Returns:
            self (for method chaining).
        """
        if not accessions:
            raise ValueError("Cannot fit on empty accession list.")

        self._accessions = list(accessions)
        self._labels = [
            f"{a.genus} {a.species} — {a.cultivar} ({a.origin_country})"
            for a in self._accessions
        ]

        # Build raw trait matrix
        raw = np.array(
            [[a.traits[k] for k in TRAIT_KEYS] for a in self._accessions],
            dtype=np.float64,
        )

        # Scale
        self._X_scaled = self._scaler.fit_transform(raw)

        # Kernel
        self._kernel.fit(self._X_scaled)
        self._K = self._kernel.compute(self._X_scaled)

        self._fitted = True
        return self

    # ------------------------------------------------------------------
    # Match
    # ------------------------------------------------------------------

    def match(
        self,
        query: dict[str, float] | TraitProfile,
        top_k: int = 5,
    ) -> list[MatchResult]:
        """Match a trait profile against all fitted accessions.

        Args:
            query: Dict containing all TRAIT_KEYS, or a TraitProfile.
            top_k: Number of top matches to return.

        Returns:
            Sorted list of MatchResult, best match first.
        """
        self._ensure_fitted()

        if top_k < 0:
            top_k = 0

        # Build query vector from dict or TraitProfile
        if isinstance(query, TraitProfile):
            q_raw = query.values.reshape(1, -1).astype(np.float64)
        elif isinstance(query, dict):
            missing = [k for k in TRAIT_KEYS if k not in query]
            if missing:
                raise KeyError(f"Query missing traits: {missing}")
            q_raw = np.array(
                [[float(query[k]) for k in TRAIT_KEYS]],
                dtype=np.float64,
            )
        else:
            raise TypeError(
                f"query must be dict or TraitProfile, got {type(query).__name__}"
            )

        # Scale query with fitted scaler
        q_scaled = self._scaler.transform(q_raw)

        # Kernel similarity: query vs all accessions
        k_query = self._kernel.compute(q_scaled, self._X_scaled)[0]

        # RKHS cosine similarity: k(x,y) / sqrt(k(x,x) * k(y,y))
        # For RBF, k(x,x) = 1.0, so this simplifies to k(x,y) / sqrt(k(y,y))
        diag = np.diag(self._K)
        cosine_rkhs = k_query / (np.sqrt(1.0 * diag) + 1e-10)

        scores = cosine_rkhs * 100.0
        ranked_indices = np.argsort(scores)[::-1]

        # Clamp top_k to available results
        actual_k = min(top_k, len(self._accessions))

        results: list[MatchResult] = []
        for rank, idx in enumerate(ranked_indices[:actual_k]):
            acc = self._accessions[idx]
            results.append(MatchResult(
                rank=rank + 1,
                accession_id=acc.accession_id,
                label=self._labels[idx],
                match_score=round(float(scores[idx]), 2),
                kernel_similarity=round(float(k_query[idx]), 6),
                accession=acc,
            ))

        return results

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def kernel_info(self) -> dict[str, Any]:
        """Return metadata about the fitted kernel matrix."""
        self._ensure_fitted()
        assert self._K is not None
        n = self._K.shape[0]
        return {
            "n_accessions": n,
            "gamma": round(self._kernel.gamma_value, 6),
            "kernel_rank": int(np.linalg.matrix_rank(self._K)),
            "kernel_trace": round(float(np.trace(self._K)), 4),
            "kernel_det": round(
                float(np.linalg.det(self._K)) if n <= 12 else -1, 8
            ),
            "frobenius_norm": round(float(np.linalg.norm(self._K, "fro")), 4),
        }

    def hilbert_distances(self) -> np.ndarray:
        """Pairwise Hilbert space distances: d_H(x,y)² = K(x,x) + K(y,y) − 2K(x,y)."""
        self._ensure_fitted()
        assert self._K is not None
        diag = np.diag(self._K)
        d_sq = diag[:, None] + diag[None, :] - 2 * self._K
        return np.sqrt(np.maximum(d_sq, 0))

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _ensure_fitted(self) -> None:
        if not self._fitted:
            raise RuntimeError("Matcher not fitted. Call fit() before querying.")
