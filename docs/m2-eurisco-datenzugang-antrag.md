# M2: EURISCO-Datenzugang — Antragsentwurf (Stand 2026-08-27)

> Zweck: Wiederaufnahme-Bedingung 1 des Loop-Closure-Markers erfüllbar machen.
> Der folgende Text ist ein SENT-ready-Entwurf für Sonny — vor dem Absenden
> prüfen, ggf. auf Englisch senden (EURISCO-Sprache), Absender ergänzen.

---

**An:** EURISCO-Koordination, Leibniz-Institut für Pflanzengenetik und
Kulturpflanzenforschung (IPK) Gatersleben — eurisco@ipk-gatersleben.de
**Betreff:** Anfrage: Zugriff auf Passport- und C&E-Daten für ein
Sorten-Empfehlungstool (KI-Nachwuchs-Einreichung, Ruhrgebiet)

Sehr geehrte Damen und Herren,

ich entwickle ein kernel-basiertes Sorten-Empfehlungstool („AgriGen AI",
Einreichung für den KI Biennale Award 2026, Digital Campus Zollverein):
Landwirte und Beratung beschreiben ein Anbau-Profil (Dürre-/Hitze-/Kälte-
toleranz, Krankheitsresistenz, N-Effizienz, Boden-pH, Vegetationsdauer,
Ertrag, Wasserbedarf, Wurzeltiefe), und das System empfiehlt passende
Genbank-Accessionen über RBF-Kernel-Ähnlichkeit auf normalisierten
Trait-Vektoren. Der Rechenkern ist fertig, evaluiert und open-source
vorbereitet; als Demo-Datengrundlage dienen derzeit transparent gekenn-
zeichnete, modellierte Musterdaten im EURISCO-JSON-Format.

Für die nächste Ausbaustufe brauche ich echten Datenzugang und bitte um
Auskunft zu folgenden Punkten:

1. **Passportdaten (MCPD):** Gibt es einen bulk-Zugang (API, CSV-Export oder
   bereitgestellten Datensatz) auf Accession-Ebene — ACCENUMB, Genus/Species,
   Herkunftsland, biologischer Status? Zielgröße zunächst ~10³–10⁴ Accessionen
   aus 3–5 Nutzpflanzen-Gruppen (Getreide, Leguminosen, Wurzel-/Knollenfrüchte).
2. **C&E-Daten:** Welche Evaluierungs-Deskriptoren sind für welche Kulturen
   in welchem Umfang vorhanden? Insbesondere: Toleranz-/Resistenz-Scores
   (Skala 1–9 bzw. 1–10), Ertrag, Vegetationsdauer, Wasserbedarf. Gibt es
   Deskriptor-Listen/Mappings ( Trait-Ontology-Referenzen), an denen ich mich
   bei der Harmonisierung orientieren kann?
3. **Lizenz/Bedingungen:** Unter welchen Bedingungen (Nutzungszweck:
   Forschung/Produkt-Prototyp, Attribution, ggf. SMTA-Relevanz) darf ein
   solcher Datensatz in ein Empfehlungstool einfließen?
4. **Alternativ:** Empfehlen Sie für diesen Zweck den Zugang über Genesys-PGR
   (inkl. OAuth-API), oder ist der direkte Weg über EURISCO zweckmäßiger?

Gerne stelle ich das Tool und die exakte Merkmals-Matrix auch in einem kurzen
Call vor. Über eine Antwort würde ich mich sehr freuen.

Mit freundlichen Grüßen
[Sonny — Adaptive AI Solutions, Kontaktdaten]

---

## Technisches Annex (nicht Teil der E-Mail — interne Vorbereitung)

**Ziel-Matrix:** 12 quantitative Traits pro Accession, normalisiert [0,1];
Rating-Dims (v−1)/9 analog 1–9-Skalen; Ertrag pro Fruchtartengruppe.

**Was der Kernel bereits kann (M2-ready, kein Umbau nötig):**
- Maskierte Distanzen: fehlende C&E-Merkmale fließen nicht ein (kein Imputing)
- Duplikat-Guard, Trust-Boundary-Validierung, [0,1]-Range-Checks
- Teilraum-γ je Anfrage-Maske; gesampelte Median-Heuristik für große n
- Eval-Gate (7 Deckel) + 59 Checks als Regressionsnetz beim Datentausch

**Harmonisierungs-Pipeline (sobald Daten da):**
Deskriptor-Mapping je Kultur → Skalen-Normalisierung → Lücken-Masken →
Crop-Group-Mapping (Genus→Gruppe) → Goldwerte/Szenario-Erwartungen neu
ableiten (bewährter Prozess aus dem 150er-Umstieg, It 24).

**Aufwandsschätzung:** Zugang + Erstimport 1–2 Tage; Harmonisierung je nach
Deskriptor-Zersplitterung 1–3 Wochen; Re-Eval inkl. Deckel-Verifikation 1 Tag.
