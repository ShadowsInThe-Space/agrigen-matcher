# Architecture Note — AgriGen Matcher

> **Status:** Draft · **Datum:** 2026-08-05 · **Autor:** Solution Architect
> **Scope:** SOLID-Analyse + Clean-Code-Refactor-Plan für `core/matcher.py`
> **Kein Code-Refactor** — dieses Dokument ist die Blaupause für den Backend Engineer.

---

## 1. SOLID-Analyse des aktuellen `core/matcher.py`

### 1.1 Status Quo

Die Datei `core/matcher.py` (≈ 250 Zeilen) enthält:

| Element | Typ | Verantwortlichkeit |
|---|---|---|
| `TRAIT_KEYS`, `DATA_PATH` | Modul-Konstanten | Konfiguration |
| `load_accessions()` | Funktion | JSON-Datei lesen |
| `extract_trait_matrix()` | Funktion | Dict → NumPy-Matrix |
| `HilbertMatcher` | Klasse | Scaler fitten, Kernel berechnen, Query matchen, Metriken, Distanzen |
| `print_banner()`, `print_kernel_info()`, `print_results()`, `demo_scenario()`, `main()` | Funktionen | Terminal-Demo / Presentation |

### 1.2 SRP-Verletzungen (Single Responsibility Principle)

**`HilbertMatcher` hat mindestens fünf Responsibilities:**

1. **Feature-Scaling** — `self.scaler = StandardScaler()`, `fit_transform()`, `transform()` im Query-Pfad
2. **Kernel-Strategie-Auswahl** — `"auto"` / `"median"` / `float` Branching in `fit()`
3. **Kernel-Matrix-Berechnung** — `rbf_kernel(self.X_scaled, gamma=...)` + gamma-Heuristik (`pdist`, `squareform`)
4. **Match-Scoring & Ranking** — Cosine-Similarity-Normalisierung, `argsort`, Score-Berechnung
5. **Result-Assembly** — Dict-Konstruktion mit Labels, Trait-Profilen, Metadaten

**Zusätzliche SRP-Verletzung auf Modulebene:**

6. **Presentation** — `print_banner()`, `print_results()`, `demo_scenario()`, `main()` sind Terminal-I/O und vermischen sich mit Business-Logic im selben Modul.
7. **Data Loading** — `load_accessions()` und `extract_trait_matrix()` koppeln fest an JSON-Format und Trait-Schema.

> **Probleme:** Die Klasse ist bei ≈ 12 Accessionen noch überschaubar, aber jede Erweiterung (neuer Kernel, anderes Datenformat, API statt CLI) erfordert Modifikation der Monolith-Klasse.

### 1.3 OCP-Verletzungen (Open/Closed Principle)

| Erweiterungsszenario | Was muss geändert werden? | Sollte aber… |
|---|---|---|
| **Neuer Kernel** (z. B. Polynomial, Laplacian, Linear) | `fit()` und `match_query()` — neue `if/elif`-Branches für gamma-Berechnung; direkte `rbf_kernel`-Aufrufe müssen ersetzt werden | über Strategy-Pattern austauschbar sein |
| **Anderes Datenformat** (CSV, Parquet, API) | `load_accessions()` umschreiben | über Loader-Interface austauschbar sein |
| **Anderer Scaler** (MinMax, RobustScaler, None) | `__init__` und `fit()` — direkte `StandardScaler`-Instanziierung | über Scaler-Interface austauschbar sein |
| **Neues Output-Format** (JSON-API statt print) | `main()` und alle `print_*`-Funktionen | über Presentation-Layer austauschbar sein |
| **Zusätzliche Trait-Keys** | `TRAIT_KEYS`-Liste + hardcoded `query_traits[k]`-Extraktion in `match_query()` | über ein Schema/Modell deklarativ sein |

> **Kernproblem:** Der Code ist *nicht* offen für Erweiterung, sondern erfordert *Modifikation* bestehender Logik bei jeder neuen Anforderung.

### 1.4 LSP (Liskov Substitution Principle)

Aktuell nicht anwendbar — es gibt keine Vererbungshierarchie. Der Refactor wird Interfaces einführen, auf die LSP dann zu beachten ist.

### 1.5 ISP (Interface Segregation Principle)

Keine Interfaces vorhanden. `HilbertMatcher` ist ein "God Object" mit breitem Interface (`fit`, `match_query`, `kernel_matrix_info`, `pairwise_hilbert_distance`). Clients, die nur matchen wollen, hängen auch an den Metrik-Methoden.

### 1.6 DIP (Dependency Inversion Principle)

`HilbertMatcher` hängt von **Konkretem** ab:
- `StandardScaler` (konkrete sklearn-Klasse, direkt instanziiert)
- `rbf_kernel` (konkrete Funktion, direkt aufgerufen)
- `json.load` (direkt in `load_accessions`)
- `TRAIT_KEYS`-Konstante (hardcoupled)

Kein Dependency Injection, keine Abstraktionen. Unit-Tests können nur über die konkrete Implementierung laufen — Mocking ist schwierig.

---

## 2. Vorgeschlagene Modul-Struktur (Clean Code)

```
core/
├── models.py          # Data classes (Accession, TraitProfile, MatchResult)
├── data_loader.py     # DataLoader Interface + JSONLoader Implementation
├── kernel.py          # KernelStrategy Interface + RBFKernel Implementation
├── scaler.py          # TraitScaler (StandardScaler wrapper)
├── matcher.py         # HilbertMatcher (orchestrator only, delegiert an oben)
└── cli.py             # Terminal-Demo (nur Presentation, keine Business-Logic)
```

### 2.1 `models.py` — Domain Models

```python
from dataclasses import dataclass, field
from typing import Any

TRAIT_KEYS: list[str] = [...]  # aus matcher.py verschoben

@dataclass(frozen=True)
class Accession:
    accession_id: str
    genus: str
    species: str
    cultivar: str
    origin_country: str
    traits: dict[str, float]

@dataclass(frozen=True)
class TraitProfile:
    """Normalisierte Repräsentation eines Trait-Vektors."""
    values: np.ndarray  # shape (n_traits,)

@dataclass(frozen=True)
class MatchResult:
    rank: int
    accession_id: str
    label: str
    match_score: float       # 0–100
    kernel_similarity: float
    accession: Accession     # volle Referenz für Detail-View
```

**Verantwortlichkeit:** Reine Datenstrukturen, keine Logik. Immutable (`frozen=True`).
**SRP:** "Repräsentiere Domain-Objekte" — nichts sonst.

### 2.2 `data_loader.py` — Data Access

```python
from abc import ABC, abstractmethod

class DataLoader(ABC):
    """Interface für Daten-Quellen."""
    @abstractmethod
    def load(self, source: str) -> list[Accession]: ...

class JSONLoader(DataLoader):
    """Lädt Accessions aus einer JSON-Datei."""
    def load(self, source: str) -> list[Accession]: ...

# Future: CSVLoader, APILoader, etc.
```

**Verantwortlichkeit:** Lese Rohdaten und erzeuge `Accession`-Objekte.
**OCP:** Neues Format → neue Klasse, kein Ändern bestehenden Codes.
**DIP:** `HilbertMatcher` hängt von `DataLoader` (Abstraktion), nicht von `JSONLoader`.

### 2.3 `kernel.py` — Kernel Strategy

```python
from abc import ABC, abstractmethod

class KernelStrategy(ABC):
    """Interface für Kernel-Funktionen im Hilbert-Raum."""
    
    @abstractmethod
    def compute(self, X: np.ndarray, Y: np.ndarray | None = None) -> np.ndarray:
        """Kernel-Matrix K(X, Y). Wenn Y=None: K(X, X)."""
        ...

class RBFKernel(KernelStrategy):
    """RBF (Gaussian) Kernel mit gamma-Heuristiken."""
    
    def __init__(self, gamma: str | float = "median"):
        self._gamma = gamma
        self._gamma_value: float | None = None
    
    def fit(self, X: np.ndarray) -> None:
        """Berechne den endgültigen gamma-Wert aus Trainingsdaten."""
        ...
    
    def compute(self, X: np.ndarray, Y: np.ndarray | None = None) -> np.ndarray:
        ...
    
    @property
    def gamma_value(self) -> float: ...

# Future: PolynomialKernel, LaplacianKernel, LinearKernel
```

**Verantwortlichkeit:** Kernel-Matrix-Berechnung + gamma-Strategie.
**OCP:** Neuer Kernel → neue Klasse implementiert `KernelStrategy`.
**SRP:** "Berechne Ähnlichkeit im Hilbert-Raum" — nichts sonst.

### 2.4 `scaler.py` — Feature Scaling

```python
class TraitScaler:
    """Wrapper für Feature-Normalisierung."""
    
    def __init__(self, strategy: str = "standard"):
        # strategy: "standard" | "minmax" | "robust" | "none"
        ...
    
    def fit_transform(self, X: np.ndarray) -> np.ndarray: ...
    def transform(self, X: np.ndarray) -> np.ndarray: ...
```

**Verantwortlichkeit:** Normalisiere Trait-Matrizen.
**OCP:** Neue Strategie → neue Map-Entry, kein Ändern der Logik.
**Hinweis:** Dünner Wrapper — rechtfertigt sich durch Testbarkeit und Austauschbarkeit.

### 2.5 `matcher.py` — Orchestrator

```python
class HilbertMatcher:
    """
    Orchestrator: delegiert an DataLoader, TraitScaler, KernelStrategy.
    Enthält KEINE Business-Logic für Scaling, Kernel-Berechnung oder Daten-Parsing.
    """
    
    def __init__(
        self,
        kernel: KernelStrategy,
        scaler: TraitScaler,
    ):
        self._kernel = kernel
        self._scaler = scaler
        self._accessions: list[Accession] = []
        self._X_scaled: np.ndarray | None = None
        self._K: np.ndarray | None = None
    
    def fit(self, accessions: list[Accession]) -> Self: ...
    def match(self, query: TraitProfile, top_k: int = 5) -> list[MatchResult]: ...
    def kernel_info(self) -> dict: ...
    def hilbert_distances(self) -> np.ndarray: ...
```

**Verantwortlichkeit:** Koordiniere die Pipeline (load → scale → kernel → rank).
**DIP:** Hängt von `KernelStrategy` und `TraitScaler` ab (Abstraktionen/Interfaces), nicht von konkreten Implementierungen.
**SRP:** "Orchestriere die Matching-Pipeline" — delegiert alle Einzelheiten.

### 2.6 `cli.py` — Presentation Layer

```python
def run_demo(loader: DataLoader, matcher: HilbertMatcher) -> None:
    """Terminal-Demo. Nur print/Formatierung. Keine Math, kein Data-Parsing."""
    ...

if __name__ == "__main__":
    main()
```

**Verantwortlichkeit:** Terminal-I/O, Formatierung, User-Facing-Texte.
**SRP:** "Präsentiere Ergebnisse" — darf keinen Einfluss auf Match-Logik haben.

---

## 3. Dependency-Graph

```
                    ┌─────────────────────────────────────────────────────────────────────────┐
                    │                         Presentation Layer                                │
                    │                                                                         │
                    │                              cli.py                                      │
                    │                    (run_demo, print_*, main)                             │
                    └──────────────────────────┬──────────────────────────────────────────────┘
                                               │ uses
                                               ▼
                    ┌─────────────────────────────────────────────────────────────────────────┐
                    │                          Orchestration Layer                              │
                    │                                                                         │
                    │                           matcher.py                                     │
                    │                         HilbertMatcher                                   │
                    │                                                                         │
                    │   Dependencies (via constructor injection):                              │
                    │     • KernelStrategy  (interface, from kernel.py)                       │
                    │     • TraitScaler     (concrete, from scaler.py)                        │
                    │   Consumes:                                                              │
                    │     • Accession[]     (from models.py)                                   │
                    │     • TraitProfile    (from models.py)                                   │
                    │   Produces:                                                              │
                    │     • MatchResult[]   (from models.py)                                   │
                    └───┬──────────────┬──────────────┬──────────────┬───────────────────────┘
                        │              │              │              │
                        │ uses         │ uses         │ uses         │ uses
                        ▼              ▼              ▼              ▼
                ┌──────────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────────┐
                │  kernel.py   │ │ scaler.py │ │ models.py │ │  data_loader.py │
                │              │ │           │ │           │ │                 │
                │ <<interface>>│ │TraitScaler│ │ Accession │ │ <<interface>>   │
                │ KernelStrategy│ │           │ │ TraitProfile│ │ DataLoader     │
                │      ▲       │ │           │ │ MatchResult│ │      ▲          │
                │      │       │ │           │ │ TRAIT_KEYS │ │      │          │
                │  RBFKernel   │ │           │ │           │ │  JSONLoader     │
                └──────────────┘ └───────────┘ └───────────┘ └─────────────────┘
                        │                                            │
                        │                                            │ produces
                        │                                            ▼
                        │                                     ┌───────────┐
                        │                                     │ models.py │
                        │                                     │ Accession │
                        │                                     └───────────┘
                        │
                   uses internally
                        │
                        ▼
                ┌─────────────────────┐
                │  External Libraries  │
                │                     │
                │  sklearn.rbf_kernel  │
                │  scipy.pdist         │
                │  numpy               │
                └─────────────────────┘
```

### 3.1 Abhängigkeits-Regeln

| Modul | Darf importieren | Darf NICHT importieren |
|---|---|---|
| `models.py` | `numpy` (nur für Typ-Hints), stdlib | — ( Bottom der Hierarchie) |
| `data_loader.py` | `models.py`, `json` (stdlib) | `matcher.py`, `kernel.py`, `scaler.py` |
| `kernel.py` | `numpy`, `sklearn.metrics.pairwise`, `scipy.spatial.distance` | `matcher.py`, `data_loader.py`, `cli.py` |
| `scaler.py` | `numpy`, `sklearn.preprocessing` | `matcher.py`, `kernel.py`, `data_loader.py` |
| `matcher.py` | `models.py`, `kernel.py` (Interface), `scaler.py` | `data_loader.py` (nur Type-Hint), `cli.py`, `json` |
| `cli.py` | `matcher.py`, `data_loader.py`, `models.py` | `kernel.py`, `scaler.py` (nur indirekt via matcher) |

### 3.2 Dependency Inversion Points

Zwei Injektions-Punkte mit Interfaces:

1. **`KernelStrategy`** — `HilbertMatcher` hängt vom Interface, nicht von `RBFKernel`.  
   *Test-Vorteil:* Mock-Kernel mit deterministischer Matrix injizierbar.

2. **`DataLoader`** — `cli.py` (oder ein zukünftiger API-Layer) injiziert den konkreten Loader.  
   *Test-Vorteil:* `InMemoryLoader` mit Test-Fixtures ohne File-I/O.

3. **`TraitScaler`** — aktuell noch konkrete Klasse, aber über `strategy`-Parameter erweiterbar.  
   *Zukunft:* `ScalerStrategy`-Interface, wenn > 2 Implementierungen nötig werden.

---

## 4. Test-Strategie

> **TDD-Regel:** Für jedes neue Modul werden Tests *zuerst* geschrieben (Red → Green → Refactor).

### 4.1 Test-Datei-Struktur

```
tests/
├── test_models.py          # Domain-Modelle
├── test_data_loader.py     # JSONLoader + DataLoader Interface
├── test_kernel.py          # RBFKernel + KernelStrategy Interface
├── test_scaler.py          # TraitScaler
├── test_matcher.py         # HilbertMatcher (Orchestrator) — refactored bestehende Tests
└── test_cli.py             # CLI/Presentation (smoke tests)
```

### 4.2 Test-Matrix pro Modul

#### `test_models.py`

| Test | Beschreibung |
|---|---|
| `test_accession_creation` | `Accession` mit allen Feldern erstellen, Werte korrekt |
| `test_accession_immutable` | `frozen=True` → `FrozenInstanceError` bei Mutation |
| `test_trait_profile_shape` | `TraitProfile.values` hat korrekte Shape |
| `test_match_result_fields` | `MatchResult` hat alle Pflichtfelder |
| `test_trait_keys_order` | `TRAIT_KEYS` hat 12 Einträge, Reihenfolge stabil |

#### `test_data_loader.py`

| Test | Beschreibung |
|---|---|
| `test_json_loader_loads_all` | Lädt alle 12 Accessionen aus `sample_eurisco.json` |
| `test_json_loader_returns_accession_type` | Rückgaben sind `Accession`-Instanzen, nicht raw dicts |
| `test_json_loader_missing_file` | `FileNotFoundError` bei nicht existierender Datei |
| `test_json_loader_invalid_format` | `ValueError` bei fehlerhaftem JSON |
| `test_json_loader_missing_trait` | `KeyError` bei fehlendem Trait-Key |

#### `test_kernel.py`

| Test | Beschreibung |
|---|---|
| `test_rbf_kernel_matrix_shape` | `compute(X)` liefert `(n, n)`-Matrix |
| `test_rbf_kernel_symmetric` | `K == K.T` |
| `test_rbf_kernel_diagonal_one` | `diag(K) ≈ 1.0` (RBF-Eigenschaft) |
| `test_rbf_kernel_values_in_01` | Alle Werte in `[0, 1]` |
| `test_rbf_gamma_auto_positive` | `gamma="auto"` → `_gamma_value > 0` |
| `test_rbf_gamma_median_positive` | `gamma="median"` → `_gamma_value > 0` |
| `test_rbf_gamma_explicit` | `gamma=0.5` → `_gamma_value == 0.5` |
| `test_rbf_kernel_query_shape` | `compute(X, Y)` mit `Y.shape=(1, n)` → `(1, n)` |
| *Future* `test_polynomial_kernel` | Sobald `PolynomialKernel` existiert |

#### `test_scaler.py`

| Test | Beschreibung |
|---|---|
| `test_scaler_fit_transform_shape` | Output-Shape == Input-Shape |
| `test_scaler_zero_mean_unit_std` | Nach `fit_transform`: `mean ≈ 0`, `std ≈ 1` pro Spalte |
| `test_scaler_transform_uses_fit` | `transform(X)` mit neuen Daten nutzt gefittete Parameter |
| `test_scaler_strategy_none` | `strategy="none"` → Identity (X unverändert) |

#### `test_matcher.py` (Refactored)

Die **bestehenden** Tests bleiben grün, werden aber umstrukturiert:

| Test-Klasse | Status | Änderung |
|---|---|---|
| `TestDataLoading` | → `test_data_loader.py` verschoben | Test gegen `JSONLoader`, nicht gegen Funktion |
| `TestTraitMatrix` | → teilweise `test_data_loader.py` + `test_models.py` | Trait-Extraktion wird zu `Accession → TraitProfile` |
| `TestMatcherFit` | bleibt in `test_matcher.py` | Nutzt injizierte Mocks für Kernel/Scaler |
| `TestMatcherQuery` | bleibt in `test_matcher.py` | Unverändert — Contract-Tests für Match-Logik |
| `TestSemanticCorrectness` | bleibt in `test_matcher.py` | Integration-Tests mit echtem RBFKernel |
| `TestHilbertMetrics` | teilen: `kernel_info` → `test_matcher.py`, Kernel-Eigenschaften → `test_kernel.py` | Metrik-Berechnung delegiert an Kernel |
| `TestEdgeCases` | bleibt in `test_matcher.py` | Unverändert |

**Wichtig:** `TestSemanticCorrectness` sind *Integration-Tests* — sie benötigen echten RBFKernel + realen Scaler. Diese Tests stellen sicher, dass der Orchestrator korrekt delegiert.

#### `test_cli.py`

| Test | Beschreibung |
|---|---|
| `test_cli_runs_without_error` | `run_demo()` mit `capsys` abfangen, kein Exception |
| `test_cli_output_contains_banner` | Ausgabe enthält `"AgriGen Matcher"` |
| `test_cli_output_contains_results` | Ausgabe enthält `"Top Matches"` |
| `test_cli_no_business_logic` | Smoke-Test: CLI ruft nur `matcher.match()` auf, keine direkte Mathematik |

### 4.3 Test-Pyramide

```
        ┌───────────┐
        │    E2E    │  test_cli.py (run_demo end-to-end)
        ├───────────┤
        │ Integration│  test_matcher.py (SemanticCorrectness mit echtem Kernel)
        ├───────────┤
        │   Unit    │  test_models, test_data_loader, test_kernel, test_scaler
        └───────────┘
```

---

## 5. Refactor-Sequenz

> **Goldene Regel:** Nach jedem Schritt müssen `pytest tests/ -v` grün sein.
> Jeder Schritt ist ein eigener Commit.

### Schritt 0: Baseline sicherstellen

```
git checkout -b refactor/solid-architecture
pytest tests/ -v --cov=core --cov-report=term-missing
```

Benchmark: Alle 30+ Tests grün. Coverage aufnehmen als Referenz.

---

### Schritt 1: `models.py` extrahieren (Low Risk)

**Was:** `TRAIT_KEYS` + `dataclass`-Definitionen aus `matcher.py` extrahieren.

**Aktion:**
1. Erstelle `core/models.py` mit `TRAIT_KEYS`, `Accession`, `TraitProfile`, `MatchResult`.
2. In `matcher.py`: `from models import TRAIT_KEYS` (re-export für Test-Kompatibilität).
3. Tests: `test_models.py` schreiben (TDD — erst Red, dann Green).

**Risiko:** Minimal. `TRAIT_KEYS` ist eine Konstante, keine Logik.
**Test-Status:** Bestehende Tests grün (Import-Path bleibt kompatibel via Re-Export).

---

### Schritt 2: `data_loader.py` extrahieren (Low Risk)

**Was:** `load_accessions()` + `extract_trait_matrix()` → `JSONLoader`-Klasse.

**Aktion:**
1. Definiere `DataLoader`-Interface in `core/data_loader.py`.
2. Implementiere `JSONLoader` — kapselt `load_accessions()` + `extract_trait_matrix()`.
3. Rückgabe: `list[Accession]` statt `list[dict]`.
4. In `matcher.py`: Behalte alte Funktionen als *Thin Wrappers* für Backwards-Kompat:
   ```python
   def load_accessions(path):
       return JSONLoader().load(path)  # delegiert
   ```
5. Tests: `test_data_loader.py` schreiben.

**Risiko:** Niedrig. Thin Wrappers garantieren, dass bestehende Tests nicht brechen.
**Test-Status:** Alle Tests grün. Wrapper delegieren korrekt.

---

### Schritt 3: `kernel.py` extrahieren (Medium Risk)

**Was:** Kernel-Logik aus `HilbertMatcher.fit()` → `RBFKernel`-Klasse.

**Aktion:**
1. Definiere `KernelStrategy`-Interface in `core/kernel.py`.
2. Implementiere `RBFKernel` mit `fit(X)` und `compute(X, Y=None)`.
3. Verschiebe gamma-Heuristiken (`"auto"`, `"median"`, `float`) in `RBFKernel.fit()`.
4. `HilbertMatcher.__init__` akzeptiert optional `kernel: KernelStrategy`:
   ```python
   def __init__(self, gamma="median", kernel=None):
       self._kernel = kernel or RBFKernel(gamma=gamma)
   ```
5. `HilbertMatcher.fit()` ruft `self._kernel.fit(X_scaled)` und `self._kernel.compute(X_scaled)` auf.
6. Tests: `test_kernel.py` schreiben.

**Risiko:** Mittel. Die `fit()`-Logik wird aufgeteilt. **Aber:** das externe Verhalten (`K`-Matrix, gamma-Wert) bleibt identisch.

**Test-Status:** `TestMatcherFit` muss unverändert grün bleiben — gleiche Kernel-Matrix, gleiche gamma-Werte.

**Compatibility-Shim:** `HilbertMatcher(gamma="median")` bleibt als Default-Konstruktor verfügbar, sodass bestehende Tests und Demo nicht brechen.

---

### Schritt 4: `scaler.py` extrahieren (Low Risk)

**Was:** `StandardScaler`-Logik → `TraitScaler`-Wrapper.

**Aktion:**
1. Erstelle `core/scaler.py` mit `TraitScaler`-Klasse.
2. `HilbertMatcher.__init__` akzeptiert optional `scaler: TraitScaler | None`:
   ```python
   def __init__(self, gamma="median", kernel=None, scaler=None):
       self._scaler = scaler or TraitScaler()
   ```
3. `fit()` und `match_query()` nutzen `self._scaler.fit_transform()` bzw. `self._scaler.transform()`.
4. Tests: `test_scaler.py` schreiben.

**Risiko:** Sehr niedrig. `StandardScaler` wird nur gewrappt, Logik ändert sich nicht.
**Test-Status:** Alle Tests grün.

---

### Schritt 5: `matcher.py` zum reinen Orchestrator machen (Medium Risk)

**Was:** `HilbertMatcher` delegiert vollständig — keine direkten sklearn/scipy-Aufrufe mehr.

**Aktion:**
1. Entferne `StandardScaler`-Import aus `matcher.py` → via `TraitScaler`.
2. Entferne `rbf_kernel`/`pdist`/`squareform`-Importe → via `KernelStrategy`.
3. `match_query()` nutzt `MatchResult`-Dataclass statt raw dict.
4. **Backwards-Compat:** `match_query()` gibt weiterhin `list[dict]` zurück (konvertiert aus `MatchResult` via `dataclasses.asdict()` oder manuellem Mapping).
5. Refactore Tests: Bestehende `TestMatcherQuery` testen weiterhin dict-Output und bleiben grün.

**Risiko:** Mittel. Output-Format muss identisch bleiben (dict mit gleichen Keys).

**Test-Status:** Alle Tests grün. Intern wird mit Dataclasses gearbeitet, extern bleibt das dict-Interface stabil.

---

### Schritt 6: `cli.py` extrahieren (Low Risk)

**Was:** `print_banner()`, `print_kernel_info()`, `print_results()`, `demo_scenario()`, `main()` → `core/cli.py`.

**Aktion:**
1. Verschiebe alle Presentation-Funktionen nach `core/cli.py`.
2. `cli.py` importiert von `matcher.py`, `data_loader.py`, `models.py`.
3. `matcher.py` enthält keine `print`-Statements oder `if __name__` mehr.
4. Tests: `test_cli.py` mit `capsys`-Smoke-Tests.

**Risiko:** Sehr niedrig. Pure Code-Movement, keine Logikänderung.
**Test-Status:** Alle Tests grün.

---

### Schritt 7: Cleanup & Deprecation

**Was:** Backwards-Compat-Shims entfernen und Imports aufräumen.

**Aktion:**
1. Entferne Thin-Wrapper-Funktionen (`load_accessions`, `extract_trait_matrix`) aus `matcher.py`, wenn keine externen Abhängigkeiten mehr.
2. Update `tests/test_matcher.py` Importe: `from core.matcher import HilbertMatcher` statt `from matcher import ...`.
3. Update `README.md` mit neuer Modul-Struktur.
4. Entferne `sys.path.insert`-Hack aus Tests → stattdessen `pyproject.toml` / `conftest.py`.
5. Final Coverage-Check.

**Risiko:** Niedrig — nur Aufräumarbeiten.
**Test-Status:** Alle Tests grün. Coverage ≥ 90%.

---

### Refactor-Sequenz Übersicht

```
Schritt 0: Baseline (Commit: "test: establish baseline coverage")
    │
Schritt 1: models.py (Commit: "refactor: extract domain models")
    │       Risiko: █░░░░ Low
    │
Schritt 2: data_loader.py (Commit: "refactor: extract DataLoader + JSONLoader")
    │       Risiko: █░░░░ Low
    │
Schritt 3: kernel.py (Commit: "refactor: extract KernelStrategy + RBFKernel")
    │       Risiko: ███░░ Medium  ← kritischster Schritt
    │
Schritt 4: scaler.py (Commit: "refactor: extract TraitScaler")
    │       Risiko: █░░░░ Low
    │
Schritt 5: matcher.py orchestrator (Commit: "refactor: HilbertMatcher becomes pure orchestrator")
    │       Risiko: ███░░ Medium
    │
Schritt 6: cli.py (Commit: "refactor: extract CLI presentation layer")
    │       Risiko: █░░░░ Low
    │
Schritt 7: cleanup (Commit: "refactor: remove compat shims, finalize structure")
            Risiko: █░░░░ Low
```

---

## 6. Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---|---|---|---|
| Kernel-Matrix-Werte ändern sich minimal durch Floating-Point-Reihenfolge | Mittel | Niedrig | Tests mit `np.allclose(atol=1e-10)` statt `==` |
| `TRAIT_KEYS`-Reihenfolge driftet zwischen Modulen | Niedrig | Hoch | Single Source of Truth in `models.py` |
| Backwards-Compat-Shims werden vergessen zu entfernen | Hoch | Niedrig | `# TODO(step-7): remove` Marker + grep |
| Import-Zyklen (circular imports) | Mittel | Mittel | Layered Architecture einhalten (siehe §3.1 Regeln) |
| Test-Coverage sinkt während Refactor | Niedrig | Mittel | Nach jedem Schritt `--cov` ausführen |

---

## 7. Akzeptanzkriterien

Nach Abschluss des Refactors muss gelten:

- [ ] `pytest tests/ -v` → alle Tests grün (0 failures)
- [ ] Coverage ≥ 90% auf `core/`
- [ ] `core/matcher.py` enthält **keine** direkten Imports von `sklearn` oder `scipy`
- [ ] `core/matcher.py` enthält **keine** `print()`-Statements
- [ ] `core/cli.py` enthält **keine** Business-Logic (keine `numpy`, `sklearn`, `scipy` Aufrufe)
- [ ] Neue Kernel-Strategien können durch Implementierung von `KernelStrategy` hinzugefügt werden **ohne** `matcher.py` zu ändern
- [ ] Neue Datenformate können durch Implementierung von `DataLoader` hinzugefügt werden **ohne** `matcher.py` zu ändern
- [ ] Jedes Modul hat ≤ 100 Zeilen (außer `matcher.py` und `cli.py`)
- [ ] `models.py` hat 0 Abhängigkeiten zu anderen Core-Modulen

---

*End of Architecture Note. Der Backend Engineer kann mit Schritt 0 beginnen.*
