# SPDX-License-Identifier: AGPL-3.0-or-later
# AgriGen Matcher · Copyright (C) 2026 Marc-Dennis Haberland (Adaptive AI Solutions)
# Kommerzielle Lizenz ohne Copyleft: hallo@adaptive-ai-solutions.de
"""Pytest configuration — ensures core/ is importable without sys.path hacks."""

import os
import sys

_CORE_DIR = os.path.join(os.path.dirname(__file__), "core")
if _CORE_DIR not in sys.path:
    sys.path.insert(0, _CORE_DIR)
