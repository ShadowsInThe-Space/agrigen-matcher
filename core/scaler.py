# SPDX-License-Identifier: AGPL-3.0-or-later
# AgriGen Matcher · Copyright (C) 2026 Marc-Dennis Haberland (Adaptive AI Solutions)
# Kommerzielle Lizenz ohne Copyleft: hallo@adaptive-ai-solutions.de
"""Feature scaling for trait matrices.

Thin wrapper around sklearn scalers, providing a stable interface
that can be swapped (Standard / MinMax / Robust / None) without
touching the matcher.
"""

from __future__ import annotations

import numpy as np
from sklearn.preprocessing import StandardScaler


class TraitScaler:
    """Normalises trait matrices using the configured strategy.

    Parameters
    ----------
    strategy
        ``"standard"``  — zero mean, unit variance (default).
        ``"none"``      — pass-through (identity).
        Future: ``"minmax"``, ``"robust"``.
    """

    _VALID_STRATEGIES = {"standard", "none"}

    def __init__(self, strategy: str = "standard") -> None:
        if strategy not in self._VALID_STRATEGIES:
            raise ValueError(
                f"Unknown scaler strategy '{strategy}'. Valid: {self._VALID_STRATEGIES}"
            )
        self._strategy = strategy
        self._impl: StandardScaler | None = (
            StandardScaler() if strategy != "none" else None
        )

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        if self._impl is None:
            return X.copy()
        return self._impl.fit_transform(X)

    def transform(self, X: np.ndarray) -> np.ndarray:
        if self._impl is None:
            return X.copy()
        return self._impl.transform(X)
