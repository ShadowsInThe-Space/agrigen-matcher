# AgriGen Matcher

KI-gestützte Sortenempfehlung durch RBF-Kernel-Projektion in den Reproducing Kernel Hilbert Space (RKHS).

## Status: PoC (Proof of Concept) — funktionierend

## Schnellstart

```bash
# Auf neobox:
cd ~/agrigen-matcher
source .venv/bin/activate
python3 core/matcher.py
```

## Struktur

```
agrigen-matcher/
├── data/
│   └── sample_eurisco.json    # EURISCO-Musterdaten (12 Accessionen, 12 Traits)
├── core/
│   └── matcher.py             # Rechenkern: RBF-Kernel + Hilbert-Raum-Matching
└── README.md                  # This file
```

## Architektur

1. **Trait-Normalisierung:** StandardScaler über 12 Merkmale (Drought, Heat, Cold, Disease, N-Efficiency, Salinity, Soil pH, Growing Days, Yield, Water, Root Depth)
2. **RBF-Kernel:** K(x,y) = exp(-γ·||x-y||²) mit Median-Heuristik für γ
3. **RKHS-Ähnlichkeit:** Cosine Similarity im Hilbert-Raum → Match-Score (%)
4. **Terminal-Demo:** 3 Szenarien (Dürre/Süd-EU, Kälte/Nord-EU, Leguminosen-Screening)

## Ziel

Einreichung für den **KI Biennale Award 2026** (Digital Campus Zollverein, Essen).
Kategorie: KI Nachwuchs (BRYCK) oder KI in Produkt & Kundenerlebnis (Vorwerk).
Deadline: 31. August 2026.
