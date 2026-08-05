"""Feature scaling for AgriGen Matcher.

Thin wrapper around sklearn scalers, providing a stable interface
and enabling future strategy swaps without touching the matcher.
"""

from __future__ import annotations

import numpy as np
from sklearn.preprocessing import StandardScaler, MinMaxScaler, RobustScaler


class TraitScaler:
    """Normalises trait matrices using configurable scaling strategies.

    Strategies:
        "standard" — zero mean, unit variance (default)
        "minmax"   — scale to [0, 1]
        "robust"   — median/IQR based (outlier-resistant)
        "none"     — identity (no scaling)
    """

    _SCALERS = {
        "standard": StandardScaler,
        "minmax": MinMaxScaler,
        "robust": RobustScaler,
    }

    def __init__(self, strategy: str = "standard") -> None:
        if strategy not in self._SCALERS and strategy != "none":
            raise ValueError(
                f"Unknown strategy '{strategy}'. "
                f"Choose from: {list(self._SCALERS.keys()) + ['none']}"
            )
        self._strategy = strategy
        self._scaler: StandardScaler | MinMaxScaler | RobustScaler | None = None
        self._fitted = False

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        if self._strategy == "none":
            self._fitted = True
            return X.copy()
        self._scaler = self._SCALERS[self._strategy]()
        result = self._scaler.fit_transform(X)
        self._fitted = True
        return result

    def transform(self, X: np.ndarray) -> np.ndarray:
        if not self._fitted:
            raise RuntimeError("Scaler not fitted. Call fit_transform() first.")
        if self._strategy == "none":
            return X.copy()
        assert self._scaler is not None
        return self._scaler.transform(X)
