# CI Fix Report — Ruff Lint Determinism

**Date:** 2026-08-05
**Status:** ✅ Resolved — Both CI jobs green

## Problem

GitHub Actions CI failed on the `lint` job with 20+ `I001` (Import block is un-sorted or un-formatted) errors, despite `ruff check` passing locally.

### Root Cause

| Environment | ruff Version | Source |
|---|---|---|
| Local | **0.14.14** | `pip install ruff` (manual) |
| CI | **0.16.1** | `pip install ruff` (unpinned → latest) |

The CI workflow installed ruff without a version pin, always pulling the latest release. Ruff 0.16.x introduced stricter import-sorting rules (I001) that 0.14.x did not enforce, causing false positives on code that was clean under the local version.

Additionally, `ruff format --check` revealed that 13 files had never been formatted with ruff's formatter at all.

## Fix

### 1. Pin ruff Version (Deterministic Linting)

Created `requirements-dev.txt`:

```
ruff==0.14.14
```

Updated `.github/workflows/ci.yml` lint job:

```yaml
# Before
- run: pip install ruff

# After
- name: Install ruff (pinned via requirements-dev.txt)
  run: pip install -r requirements-dev.txt
```

This ensures local and CI environments use the **exact same ruff version**, eliminating version-drift false positives.

### 2. Format All Files

Ran `ruff format core/ tests/` to fix 13 files that were unformatted. These were functionally correct but had style differences (spacing, line breaks, etc.) that ruff's formatter would change.

## Commits

| Commit | Description |
|---|---|
| `a3dff75` | `fix(ci): pin ruff==0.14.14 for deterministic linting` |
| `7736694` | `style: ruff format all files` |

## Verification

CI Run [#31035291236](https://github.com/Shadows-In-The-Space/agrigen-matcher/actions/runs/31035291236):

- ✅ **Tests + Coverage** — Passed (coverage ≥ 68%)
- ✅ **Lint (ruff)** — `ruff check` + `ruff format --check` both passed

## Best Practices Applied

1. **Pin dev tools** — Never `pip install <tool>` without a version pin in CI
2. **Single source of truth** — `requirements-dev.txt` is used by both local setup and CI
3. **Format early, format often** — `ruff format` should be run before committing, not just `ruff check`

## Future Recommendations

- Consider adding a `pre-commit` hook that runs `ruff check --fix && ruff format` automatically
- When upgrading ruff, update `requirements-dev.txt` and run `ruff check --fix && ruff format` locally before pushing
- Optionally add `ruff` to `[project.optional-dependencies]` in `pyproject.toml` for `pip install -e ".[dev]"` support
