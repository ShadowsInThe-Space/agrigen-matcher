# Pedigree-/Stammbaum-Daten — Quellen und Abdeckung

Stand: 2026-08-27 (Side-Chat-Recherche, gleicher Tag wie CPVO-VD-Funde)

## Ergebnis in Kürze

**83 der 373 BSL-2026-Sorten (22,3 %) haben ein substanzielles offizielles Pedigree**
(Feld `ancest`/ANCEST aus Genbank-Passdaten), abgelegt in
`genesys-ancestry.json` mit Institut/Accession als Provenanz je Sorte.

| Frucht | Sorten | mit Pedigree |
|---|---|---|
| Winterweizen | 165 | 43 |
| Wintergerste (2 Listen) | 122 | 27 |
| Dinkel | 29 | 6 |
| Hafer | 22 | 7 |
| Winterroggen | 35 | 0 (Hybrid-Eltern = Geschäftsgeheimnis) |

## Datenroute (funktioniert, anonym, skriptbar)

EURISCO Release 3 (Oracle-APEX-Frontend auf `eurisco.ipk-gatersleben.de`) nutzt
die **Genesys Catalog API v2** (`api.genesys-pgr.org`) als Backend:

1. `POST /oauth/token` (client_credentials; die anonymen Client-Credentials des
   öffentlichen EURISCO-Frontends, Rolle `ROLE_EVERYONE`; für Dauernutzung
   sollten eigene Genesys-API-Credentials beantragt werden).
2. `POST /api/v2/acn/filter?d=ASC&l=100&s=seqNo` mit Body
   `{"_text":"\"<Name>\"","networks":["ECPGR"],"historic":false}`
   und Headern `Origin/Referer: https://eurisco.ipk-gatersleben.de`
   (ohne Origin-Header → 403).
3. Die Antwort enthält je Accession direkt das Feld **`ancest`** (MCPD
   „Ancestry"), zusätzlich `accessionName`, `genus`, `instituteCode`.

Match-Regel: `genus` passend zur Frucht UND `accessionName` == Sortenname
(normalisiert). Pro Sorte wurde das erste non-null `ancest` übernommen.
Abfrage-Skript (Credentials bewusst NICHT im Repo): side-chat /tmp-Kopie;
Batch: 373 Einzelabfragen, 150 ms Drossel.

Beispiele: `Debian: (Tobak x Elixer) x Forum`, `KWS Donovan: Tobak x Anapolis`,
`Knut: Sheriff x RGT Reform`, `Julius: Diplomat/3/M.Huntsman//Multiweiss 2*/Jubilar`.

## Sackgassen (dokumentiert, um sie nicht erneut zu probieren)

- **CPVO-Akten**: öffentliche Dokumente enthalten nur Titel-Entscheidungen und
  UPOV-VD (Merkmale, keine Eltern). Technical Questionnaires haben zwar ein
  Genealogy-Feld, hängen hinter Login-Endpunkten (`/tlo/applications/tqsearch`
  → „Unauthorized"). Ein kostenloses MyPVR-Konto könnte das ggf. freischalten
  (ungetestet, braucht E-Mail-Verifizierung).
- **GRIN-Global (USDA)**: anonym nutzbar, aber US-Genbank — „Tobak" liefert nur
  *Nicotiana*; aktuelle EU-Zuchtsorten sind nicht abgelegt.
- **WHEALBI-Panels**: Gerste (Bustos-Korts 2019, TPJ, Supp S1 via EuropePMC
  `/supplementaryFiles`-API) matcht **7/122** unserer Gersten; Weizen
  (He et al. 2019, Nat. Genet., Supp Table 1 von nature.com) matcht **1/165**.
  Beide Panels sind weltweit-divers, nicht die deutsche BSL-Elite. (He 2019
  hat eine echte Pedigree-Spalte mit CIMMYT-Notation — für internationale
  Sorten gut, für uns irrelevant dünn.)
- **CerealsDB (Bristol)**: Pedigree-Browser existiert nicht mehr (nur noch
  SNP-Marker-Tools).
- **Rassenlijst.nl**: Host tot (HTTP 000).
- **Züchter-Kreuzungsformeln**: per Web-Recherche nicht öffentlich (Tobak,
  KWS Mintum, RGT Reform geprüft — keine Eltern auffindbar). Falls später
  erhoben: nur die Kreuzungsformel als Fakt extrahieren, keinen Prosatext.
- **EURISCO-UI Detailansicht**: zeigt `ancest` nicht an; nur über die API (s.o.)
  bzw. Genesys sichtbar.

## Mathematische Einordnung

Der Kinship-Kernel über Ahnen-Gewichte (Eltern ½, Großeltern ¼, …; Self-Token
mit Gewicht 1; Kosinus-Normalisierung) ist als Gram-Matrix nichtnegativer
Vektoren **per Konstruktion PSD** und damit konvex mit dem Trait-RBF-Kernel
fusionierbar (`K = α·K_traits + γ·K_pedigree` bleibt PSD, bleibt RKHS).
Implementation: `mvp/pedigree.ts`, Demo: `mvp/pedigree-demo.ts`.

## Offene Hebel für mehr Abdeckung

1. EURISCO/IPK-Formalanfrage (`docs/m2-eurisco-datenzugang-antrag.md`) — jetzt
   gezielt um Ancestry-bessere Institute/Crops ergänzen; formal sauber.
2. MyPVR-Konto testen (TQ-Genealogy).
3. TSchechische National-DB (EVIGEZ/CZE122) direkt — CZE122 liefert bereits
   die meisten unserer `ancest`-Werte.
4. Namen im Pedigree transitive auflösen: viele Eltern (Tobak, Julius,
   RGT Reform, Sheriff, Elixer, Forum, …) stehen selbst in der BSL →
   Kinship-Kernel verbindet sie im eigenen Katalog.
