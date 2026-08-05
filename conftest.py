"""Pytest configuration — ensures core/ is importable without sys.path hacks."""

import os
import sys

_CORE_DIR = os.path.join(os.path.dirname(__file__), "core")
if _CORE_DIR not in sys.path:
    sys.path.insert(0, _CORE_DIR)
