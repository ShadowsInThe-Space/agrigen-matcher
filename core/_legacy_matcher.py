"""
AgriGen Matcher — Mathematischer Rechenkern
============================================
Semantisches Sorten-Matching via RBF-Kernel-Projektion in den Hilbert-Raum.

Architektur:
  1. Trait-Vektoren werden normalisiert
  2. RBF-Kernel bildet Trait-Vektoren in einen hochdimensionalen Hilbert-Raum ab
     (Reproducing Kernel Hilbert Space — RKHS)
  3. Query-Profil wird in denselben Raum projiziert
  4. Cosine Similarity im Hilbert-Raum liefert Match-Scores

Verwendete Mathematik:
  - RBF Kernel: K(x,y) = exp(-gamma * ||x-y||²)
  - Dadurch wird jede Sorte als Funktion im Hilbert-Raum repräsentiert
  - Die Kernel-Matrix spannt den Hilbert-Raum auf
  - Match-Score = normalisierte Ähnlichkeit im RKHS

Quellen:
  - Gianola et al. (2008): RKHS Regression for Genomic Prediction (PMC2323816)
  - Schölkopf & Smola (2002): Learning with Kernels
"""

import json
import os
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.metrics.pairwise import rbf_kernel
from scipy.spatial.distance import pdist

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "sample_eurisco.json")

TRAIT_KEYS = [
    "drought_tolerance",
    "heat_tolerance",
    "cold_tolerance",
    "disease_resistance",
    "nitrogen_efficiency",
    "salinity_tolerance",
    "soil_ph_min",
    "soil_ph_max",
    "growing_days",
    "yield_potential_t_ha",
    "water_requirement_mm",
    "root_depth_cm",
]

# ---------------------------------------------------------------------------
# Daten laden
# ---------------------------------------------------------------------------


def load_accessions(path: str) -> list[dict]:
    """Läd Sorten-Accessions aus JSON-Datei."""
    with open(path, "r") as f:
        return json.load(f)


def extract_trait_matrix(accessions: list[dict]) -> tuple[np.ndarray, list[str]]:
    """
    Extrahiert die Trait-Matrix (n_accessions × n_traits).
    Rückgabe: (X, labels) wobei X die normalisierte Feature-Matrix ist.
    """
    raw = []
    labels = []
    for acc in accessions:
        traits = acc["traits"]
        vec = [float(traits[k]) for k in TRAIT_KEYS]
        raw.append(vec)
        labels.append(
            f"{acc['genus']} {acc['species']} — {acc['cultivar']} ({acc['origin_country']})"
        )

    X = np.array(raw, dtype=np.float64)
    return X, labels


# ---------------------------------------------------------------------------
# Hilbert-Raum-Projektion via RBF-Kernel
# ---------------------------------------------------------------------------


class HilbertMatcher:
    """
    RKHS-basierter Matcher für Sorten-Empfehlungen.

    Der RBF-Kernel projiziert dieTrait-Vektoren in einen
    unendlich-dimensionalen Hilbert-Raum. Die Ähnlichkeit zweier Sorten
    im Hilbert-Raum entspricht ihrer funktionalen Nähe im Merkmalsraum.
    """

    def __init__(self, gamma: str | float = "auto"):
        """
        Args:
            gamma: RBF-Kernel-Parameter.
                   "auto" → 1/(n_features * Var(X))
                   "median" → 1/median(pairwise_distances²)  (heuristisch, empfohlen)
                   float → expliziter Wert
        """
        self.gamma = gamma
        self.scaler = StandardScaler()
        self.X_scaled = None
        self.K = None  # Kernel-Matrix (Hilbert-Raum-Repräsentation)
        self.labels = None
        self.accessions = None
        self._gamma_value = None

    def fit(self, X: np.ndarray, labels: list[str], accessions: list[dict]):
        """Fittet den Matcher: Normalisierung + Kernel-Matrix-Berechnung."""
        self.X_scaled = self.scaler.fit_transform(X)
        self.labels = labels
        self.accessions = accessions

        n_features = X.shape[1]

        if self.gamma == "auto":
            self._gamma_value = 1.0 / (n_features * X.var())
        elif self.gamma == "median":
            # Median-Heuristik braucht mindestens 2 Accessionen
            if self.X_scaled.shape[0] < 2:
                self._gamma_value = 1.0
            else:
                sq_dists = pdist(self.X_scaled, "sqeuclidean")
                median_sq_dist = np.median(sq_dists)
                self._gamma_value = 1.0 / (median_sq_dist + 1e-10)
        else:
            self._gamma_value = float(self.gamma)

        # Kernel-Matrix = Hilbert-Raum-Darstellung aller Sorten
        self.K = rbf_kernel(self.X_scaled, gamma=self._gamma_value)

        return self

    def match_query(self, query_traits: dict, top_k: int = 5) -> list[dict]:
        """
        Matcht ein Zielprofil gegen alle Accessionen im Hilbert-Raum.

        Args:
            query_traits: Dict mit denselben TRAIT_KEYS
            top_k: Anzahl Top-Matches

        Returns:
            Sortierte Liste mit Match-Scores
        """
        q_vec = np.array([[float(query_traits[k]) for k in TRAIT_KEYS]])
        q_scaled = self.scaler.transform(q_vec)

        # RBF-Kernel zwischen Query und allen Sorten
        k_query = rbf_kernel(q_scaled, self.X_scaled, gamma=self._gamma_value)[0]

        # Normalisierung auf Match-Score (0-100%)
        # K(x,x) = 1.0 für RBF → Cosine-Similarity im RKHS = k(x,y)/sqrt(k(x,x)*k(y,y))
        diag = np.diag(self.K)
        cosine_rkhs = k_query / (np.sqrt(1.0 * diag) + 1e-10)

        # In Prozent
        scores = cosine_rkhs * 100.0

        # Sortieren
        ranked = np.argsort(scores)[::-1]

        results = []
        for rank, idx in enumerate(ranked[:top_k]):
            results.append(
                {
                    "rank": rank + 1,
                    "accession_id": self.accessions[idx]["accession_id"],
                    "label": self.labels[idx],
                    "match_score": round(float(scores[idx]), 2),
                    "kernel_similarity": round(float(k_query[idx]), 6),
                    "genus": self.accessions[idx]["genus"],
                    "species": self.accessions[idx]["species"],
                    "cultivar": self.accessions[idx]["cultivar"],
                    "origin": self.accessions[idx]["origin_country"],
                    "traits": self.accessions[idx]["traits"],
                }
            )

        return results

    def kernel_matrix_info(self) -> dict:
        """Gibt Metadaten zur Kernel-Matrix zurück."""
        return {
            "n_accessions": self.K.shape[0],
            "gamma": round(self._gamma_value, 6),
            "kernel_rank": int(np.linalg.matrix_rank(self.K)),
            "kernel_trace": round(float(np.trace(self.K)), 4),
            "kernel_det": round(
                float(np.linalg.det(self.K)) if self.K.shape[0] <= 12 else -1, 8
            ),
            "frobenius_norm": round(float(np.linalg.norm(self.K, "fro")), 4),
        }

    def pairwise_hilbert_distance(self) -> np.ndarray:
        """
        Hilbert-Raum-Distanzen zwischen allen Sorten.
        d_H(x,y)² = K(x,x) + K(y,y) - 2K(x,y)
        """
        diag = np.diag(self.K)
        d_sq = diag[:, None] + diag[None, :] - 2 * self.K
        return np.sqrt(np.maximum(d_sq, 0))


# ---------------------------------------------------------------------------
# Terminal-Demo
# ---------------------------------------------------------------------------


def print_banner():
    print("=" * 68)
    print("  AgriGen Matcher — RBF-Kernel Sorten-Empfehlung im Hilbert-Raum")
    print("  Proof of Concept · KI Biennale Award 2026")
    print("=" * 68)
    print()


def print_kernel_info(matcher: HilbertMatcher):
    info = matcher.kernel_matrix_info()
    print("── Kernel-Matrix (Hilbert-Raum) ──────────────────────────")
    print(f"  Accessionen im Raum:    {info['n_accessions']}")
    print(f"  RBF gamma:              {info['gamma']}")
    print(
        f"  Rang der Kernel-Matrix: {info['kernel_rank']} (von {info['n_accessions']})"
    )
    print(f"  Spur (Trace):           {info['kernel_trace']}")
    print(f"  Frobenius-Norm:         {info['frobenius_norm']}")
    print("  → Vollständige Hilbert-Raum-Repräsentation aktiv")
    print()


def print_results(results: list[dict], query_name: str):
    print(f"── Top Matches für: {query_name} ──────────────────────────")
    print()

    # Header
    print(f"  {'#':<3} {'Score':>6}  {'Sorte':<45} {'Herkunft':<12}")
    print(f"  {'─' * 3} {'─' * 6}  {'─' * 45} {'─' * 12}")

    for r in results:
        sorte = f"{r['genus']} {r['species']} — {r['cultivar']}"
        if len(sorte) > 45:
            sorte = sorte[:42] + "..."
        print(
            f"  {r['rank']:<3} {r['match_score']:>5.1f}%  {sorte:<45} {r['origin']:<12}"
        )

    print()

    # Detail für Top-1
    top = results[0]
    print(f"  ★ Top-Match Detail: {top['cultivar']}")
    print(f"    Match-Score (RKHS Cosine): {top['match_score']:.2f}%")
    print(f"    Kernel-Ähnlichkeit (K(x,y)): {top['kernel_similarity']:.6f}")
    print("    Trait-Profil:")
    for k, v in top["traits"].items():
        print(f"      {k:<25} {v}")
    print()


def demo_scenario(matcher: HilbertMatcher):
    """Führt 3 Demo-Szenarien aus."""

    scenarios = [
        {
            "name": "Szenario A: Dürre-resistente Sorte für Südeuropa (hitze + dürr + salz)",
            "traits": {
                "drought_tolerance": 9,
                "heat_tolerance": 9,
                "cold_tolerance": 3,
                "disease_resistance": 6,
                "nitrogen_efficiency": 6,
                "salinity_tolerance": 7,
                "soil_ph_min": 5.8,
                "soil_ph_max": 8.0,
                "growing_days": 120,
                "yield_potential_t_ha": 10.0,
                "water_requirement_mm": 400,
                "root_depth_cm": 180,
            },
        },
        {
            "name": "Szenario B: Kälte-resistente Sorte für Nordeuropa (frost + krankheitsresistenz)",
            "traits": {
                "drought_tolerance": 4,
                "heat_tolerance": 3,
                "cold_tolerance": 10,
                "disease_resistance": 8,
                "nitrogen_efficiency": 7,
                "salinity_tolerance": 4,
                "soil_ph_min": 5.8,
                "soil_ph_max": 7.5,
                "growing_days": 155,
                "yield_potential_t_ha": 7.5,
                "water_requirement_mm": 580,
                "root_depth_cm": 95,
            },
        },
        {
            "name": "Szenario C: N-fixierende, wasser-effiziente Sorte (Leguminosen-Screening)",
            "traits": {
                "drought_tolerance": 7,
                "heat_tolerance": 6,
                "cold_tolerance": 6,
                "disease_resistance": 6,
                "nitrogen_efficiency": 10,
                "salinity_tolerance": 5,
                "soil_ph_min": 5.8,
                "soil_ph_max": 7.5,
                "growing_days": 110,
                "yield_potential_t_ha": 4.0,
                "water_requirement_mm": 400,
                "root_depth_cm": 120,
            },
        },
    ]

    for s in scenarios:
        results = matcher.match_query(s["traits"], top_k=5)
        print_results(results, s["name"])


def main():
    print_banner()

    # Daten laden
    accessions = load_accessions(DATA_PATH)
    print(f"Lade {len(accessions)} Accessionen aus EURISCO-Musterdaten...")

    X, labels = extract_trait_matrix(accessions)
    print(f"Trait-Matrix: {X.shape[0]} Sorten × {X.shape[1]} Merkmale")
    print()

    # Matcher fitten
    matcher = HilbertMatcher(gamma="median")
    matcher.fit(X, labels, accessions)

    # Kernel-Info
    print_kernel_info(matcher)

    # Demo-Szenarien
    demo_scenario(matcher)

    print("=" * 68)
    print("  PoC abgeschlossen. Engine bereit für API/UI-Integration.")
    print("=" * 68)


if __name__ == "__main__":
    main()
