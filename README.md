# AgriGen Matcher

KI-gestützte Sortenempfehlung durch RBF-Kernel-Projektion in den Reproducing Kernel Hilbert Space (RKHS) — 12 quantitative Nutzpflanzen-Traits auf EURISCO-Musterdaten.

## Status: PoC (Proof of Concept) — funktionierend

## Schnellstart

### TypeScript-MVP (primärer Einstieg)

Zero Dependencies, lauffähig ab **Node ≥ 22.18 ohne Flags** (Type-Stripping ist ab dieser Version standardmäßig aktiv):

```bash
node mvp/demo.ts        # Terminal-Demo: 3 Szenarien (vom Repo-Root)
node mvp/selftest.ts    # Port-Selbsttest: Kernel-Invarianten

# alternativ im mvp/-Ordner:
cd mvp
npm run demo
npm run selftest
```

### Python-Kern

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install pytest pytest-cov scikit-learn scipy numpy   # identisch zur CI
python core/cli.py
```

Entry-Point ist **`core/cli.py`** (nicht `core/matcher.py`). Hinweis: `python -m core.cli` funktioniert nicht, weil `core/` Flat-Imports verwendet — daher der Skript-Aufruf wie oben.

## Struktur

```
agrigen-matcher/
├── mvp/                        # TypeScript-Referenz-Port (primärer Einstieg, zero deps)
│   ├── kernelMath.ts           # Kernel-Kern — Port des SeedShuffle-Kernels (s. Header dort)
│   ├── traits.ts               # 12-Trait-Raum, Query-Extraktion, Katalog-Normalisierung
│   ├── metrics.ts              # Rang & Eigenwerte (Jacobi) für die Kernel-Diagnose
│   ├── demo.ts                 # Terminal-Demo (3 Szenarien)
│   ├── selftest.ts             # Port-Selbsttest (Kernel-Invarianten)
│   └── package.json            # npm run demo / npm run selftest (Node ≥ 22.18)
├── core/                       # SOLID Python-Rebuild (Strategy/DI)
│   ├── cli.py                  # Entry-Point der Python-Demo
│   ├── matcher.py              # HilbertMatcher — Orchestrierung (skalieren → kernel → ranken)
│   ├── kernel.py               # RBFKernel + KernelStrategy (scikit-learn/scipy)
│   ├── scaler.py               # TraitScaler (StandardScaler)
│   ├── data_loader.py          # JSONLoader
│   └── models.py               # Datenmodelle
├── tests/                      # 130 Pytest-Tests (7 Dateien)
├── data/
│   └── sample_eurisco.json     # EURISCO-Musterdaten (12 Accessionen, 12 Traits)
├── docs/
│   ├── architecture.md         # Architektur-Doku
│   └── ci-fix-report.md        # CI-Nachbesserungs-Report
└── .github/workflows/ci.yml    # CI: pytest + Coverage (≥ 68 %), ruff lint + format
```

## Zwei Implementierungen — bewusst nicht derselbe Rechenkern

- **`mvp/` — Reference-Port (TypeScript):** Semantisch identischer Port des produktionserprobten SeedShuffle-Kernels (`seedshuffle_aistudio/server/utils/kernelMath.ts`). Das vollständige Diff ist im Header von `mvp/kernelMath.ts` dokumentiert: Renames strain → candidate, angepasste `validateFeatureRanges`-Fehlermeldung, Auslagerung der domänenspezifischen Feature-Liste nach `traits.ts`. Das Verhalten wird durch die Test-Suite des Quell-Repos abgedeckt (`tests/unit/kernelMath.spec.ts`, 39 Unit-Tests).
- **`core/` — SOLID Python-Rebuild:** Unabhängige Neuimplementierung nach Dependency-Inversion (injizierte `KernelStrategy`, `TraitScaler`, Loader), abgesichert durch 130 Pytest-Tests und CI.

Die beiden Implementierungen sind ausdrücklich **nicht** als derselbe Rechenkern behauptet: Normalisierungen (TS: Rating-/min-max-Skalierung auf [0,1]; Python: StandardScaler) und γ-Kalibrierungen unterscheiden sich — die Scores sind nicht numerisch identisch. Der TS-Port dient als verifizierbare Referenz des produktionserprobten Kernel-Verhaltens, der Python-Kern als testbare Architektur-Basis.

## Architektur (Kernel-Pipeline)

1. **Datengrundlage:** 150 Accessionen im EURISCO-JSON-Format — 12 handkuratierte + 138 deterministisch generierte (`data/generate-150.ts`, Seed 20260827, mit agronomischen Korrelationen). **Modellierte Musterdaten, kein EURISCO-Export** — die C&E-Trait-Matrix existiert dort nicht in diesem Format (M2/Roadmap). Die 12er-Referenz bleibt in `data/sample_eurisco.json`.
2. **Trait-Normalisierung:** 12 Merkmale (Drought, Heat, Cold, Disease, N-Efficiency, Salinity, Soil pH, Growing Days, Yield, Water, Root Depth)
2. **RBF-Kernel:** K(x,y) = exp(-γ·||x-y||²) mit γ via Median-Heuristik
3. **RKHS-Ähnlichkeit (nur Katalog-Kern):** Der RBF-Kernel läuft auf den normalisierten Trait-Vektoren mit **fester** Maske — feste Maske ⇒ PSD ⇒ echter RKHS; der Kernelwert ist der RKHS-Kosinus der Einbettungen (Einheitsdiagonale K(z,z)=1 gegeben; Details: JSDoc zu `dimensionNormalizedRbf` bzw. Guard `assertFixedScoringMask` in `mvp/kernelMath.ts`)
4. **Query-Scoring (kein Kernel):** Das Ranking einer Anfrage nutzt einseitige Hinge-Terme (Satisficing) im Query-Subraum — asymmetrisch in (Anfrage, Kandidat), keine PSD-Garantie, ausdrücklich kein Kernel und keine RKHS-Lesart (Details: `mvp/scoring.ts`)
5. **Ranking:** Hinge-Score primär; bei Gleichstand entscheidet die RBF-Profilähnlichkeit im aktiven Teilraum (`rankCandidates`) — Satisficing wird nie von Ähnlichkeit überschrieben
6. **Terminal-Demo:** 3 Szenarien (Dürre/Süd-EU, Kälte/Nord-EU, Leguminosen-Screening)

## Messwerte (label-freie Eval, 20 Loop-Iterationen)

Alle Zahlen reproduzierbar via `node mvp/eval.ts` bzw. als Pins in `node mvp/selftest.ts`
(55 Checks; Crop-Group-Pins gemessen am 150er-Datensatz). Methodik und Keep/Revert-Entscheidungen: `docs/algo-iterations.md`.

| Kriterium | Wert |
|---|---|
| Identity-Retrieval (Anfrage = Sortenprofil, Vollmaske) | **1.0000** (150/150, selftest-gepinnt) |
| Teilraum-Identity (jedes k ∈ {2,3,4,6,8,12}) | **1.0000** |
| Identity auf synthetischem Katalog n=100 | 1.0000 |
| Wizard-Genauigkeit (5-Stufen + Toleranzband, Vollmaske / 4 Dims) | top-1 1.000 / top-3 0.989 |
| LOO Top-3-Stabilität (echte Demo-Anfragen) | 1.0000 |
| Bedauerns-Rate bei Anfrage-Rauschen ε=0.01 / 0.02 / 0.05 (Toleranzband δ=0.1) | 0.0000 / 0.0000 / 0.0010 |
| Top-3-Treue bei Messrauschen in Sorten-Traits (ε=0.02 / 0.05) | 0.5989 / 0.4896 |
| γ-Kalibration bei n=5000 (gesampelte Median-Heuristik) | ~99 ms statt ~20 s, Top-1 unverändert |

Grenze (beabsichtigt): exakte Duplikate im Katalog sind von keinem Matcher
unterscheidbar und werden daher von `buildCatalog` als Datenfehler abgelehnt.

## Ziel

Einreichung für den **KI Biennale Award 2026** (Digital Campus Zollverein, Essen).
Kategorie: KI Nachwuchs (BRYCK) oder KI in Produkt & Kundenerlebnis (Vorwerk).
Deadline: 31. August 2026.
