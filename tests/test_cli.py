"""Tests for core/cli.py — presentation layer smoke tests."""

import pytest
import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "core"))
from cli import run_demo, print_banner, print_results
from data_loader import JSONLoader
from kernel import RBFKernel
from matcher import HilbertMatcher
from models import TRAIT_KEYS, Accession, MatchResult
from scaler import TraitScaler


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_accession() -> Accession:
    return Accession(
        accession_id="TEST-001",
        genus="Triticum",
        species="aestivum",
        cultivar="TestCv",
        origin_country="AT",
        traits={k: 5.0 for k in TRAIT_KEYS},
    )


def _make_result(rank: int = 1) -> MatchResult:
    return MatchResult(
        rank=rank,
        accession_id="TEST-001",
        label="Test",
        match_score=95.5,
        kernel_similarity=0.987,
        accession=_make_accession(),
    )


@pytest.fixture
def real_matcher():
    """Real matcher fitted on sample data via run_demo internals."""
    loader = JSONLoader()
    import os
    data_path = os.path.join(
        os.path.dirname(__file__), "..", "data", "sample_eurisco.json"
    )
    accessions = loader.load(data_path)
    m = HilbertMatcher(
        kernel=RBFKernel(gamma="median"),
        scaler=TraitScaler(),
    )
    m.fit(accessions)
    return m


# ---------------------------------------------------------------------------
# print_banner
# ---------------------------------------------------------------------------

class TestPrintBanner:
    def test_outputs_text(self, capsys):
        print_banner()
        captured = capsys.readouterr()
        assert "AgriGen Matcher" in captured.out


# ---------------------------------------------------------------------------
# print_results
# ---------------------------------------------------------------------------

class TestPrintResults:
    def test_outputs_match_data(self, capsys):
        results = [_make_result(rank=1), _make_result(rank=2)]
        print_results(results, "Test Query")
        captured = capsys.readouterr()
        assert "Test Query" in captured.out
        assert "95.5" in captured.out
        assert "TEST-001" in captured.out or "TestCv" in captured.out


# ---------------------------------------------------------------------------
# run_demo — end-to-end smoke test
# ---------------------------------------------------------------------------

class TestRunDemo:
    def test_runs_without_error(self, capsys):
        run_demo()
        captured = capsys.readouterr()
        assert len(captured.out) > 0

    def test_output_contains_banner(self, capsys):
        run_demo()
        captured = capsys.readouterr()
        assert "AgriGen Matcher" in captured.out

    def test_output_contains_results(self, capsys):
        run_demo()
        captured = capsys.readouterr()
        assert "Top Matches" in captured.out or "Top-Match" in captured.out

    def test_output_contains_scenario_names(self, capsys):
        run_demo()
        captured = capsys.readouterr()
        assert "Szenario" in captured.out or "Scenario" in captured.out

    def test_output_mentions_kernel_info(self, capsys):
        run_demo()
        captured = capsys.readouterr()
        assert "gamma" in captured.out.lower()

    def test_no_numpy_or_sklearn_in_cli_module(self):
        """cli.py must be presentation-only — no direct math imports."""
        import cli
        import inspect
        source = inspect.getsource(cli)
        # Allow data_loader/matcher imports but not raw numpy/sklearn/scipy usage
        assert "import numpy" not in source
        assert "import sklearn" not in source
        assert "from sklearn" not in source
        assert "import scipy" not in source
        assert "from scipy" not in source
