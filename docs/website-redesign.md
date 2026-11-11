# Neugestaltung der Projektseite im Flower-Designs-Stil

Planungsstand zu Issue #443. Die Seite `docs/index.html` bleibt in diesem Schritt unverändert; hier steht, was der Entwurf zeigt, was es heute schon gibt und was fehlt.

## Entwurf

Zwei Design-Artboards der Startseite (1360 px, fluid bis Handybreite) im Design-System „Flower-Designs": **Startseite** (Theme `creme`, hell) und **Startseite dunkel** (Theme `wald`). Farben, Figtree, Pillen-Buttons, flache Pflanzenmotive, keine Schatten. Die helle Fassung wurde lokal in 1360 px und 390 px angesehen, die dunkle nur in 1360 px (Regal bis App-Block), mit Platzhalter-Motiven und Ersatzschrift. Beide sind Design-Artboards, kein fertiges HTML.

## Unterschiede der dunklen Fassung

- Grund und Karten in Waldgrün, Text in Creme.
- Hero und Fuß bleiben hell, die Fläschchen liegen auf hellen Feldern (Vorgabe des Systems: Motive sind für `cream` gebaut).
- Der App-Block ist eine Stufe dunkler als die Seite (`surface-sunken`), sonst verschwindet er im Grund.
- Balken bei „Top Marken" in `sage-400` statt `leaf-600`, wegen des Kontrasts auf dunklem Kartengrund.
- Beide Artboards sind getrennte Dateien; Änderungen an einer müssen in der anderen nachgezogen werden.

## Was der Entwurf bereits enthält

| Bereich | Inhalt |
| --- | --- |
| Kopfzeile | Wortmarke, Navigation (Regal, Tagebuch, App, Zahlen, Datenschutz), DE/EN-Schalter |
| Hero | Titel „Nagellacke", Zeile „Deine Lacksammlung als Skizzenbuch", Text, zwei Buttons, drei Tags, vier Eckpflanzen, zwei Hügel |
| Regal | neun Lacke als flache Fläschchen mit Füllstand, Status-Tag, Notiz, vier Filter |
| Tagebuch | vier Einträge, Haltbarkeit als fünf Punkte mit Text für Screenreader |
| App | vier Tabs (Sammlung, Tagebuch, Statistik, Sticker), Handyrahmen mit je eigenem Bildschirm |
| Zahlen | Balken Top-Marken und Farbfamilien, große Zahlen 48 / 132 / 7 |
| Fuß | Datenschutz, GitHub, Seitenanfang, Hinweis zur eingestellten Android-App |
| Theme | Regler `creme` / `wald`; Hero und Fuß bleiben immer hell |
| Handy | Raster stapelt, Regal zweispaltig, untere Hero-Motive entfallen |

## Abgleich mit der heutigen Seite

| Funktion | Heute (`docs/index.html`) | Entwurf |
| --- | --- | --- |
| Deutsch/Englisch | funktioniert (`data-i18n`, `sketch.js`) | nur Attrappe |
| Regal-Filter | ja | ja |
| Regal-Detail mit Notiz und Trage-Zähler | ja | fehlt (Notiz steht auf der Karte, Zähler nicht) |
| Tagebuch-Karten zum Umdrehen | ja | nein, Karten zeigen alles offen |
| App-Tabs mit Handy | ja | ja |
| Scroll-Einblendungen | ja | nein |
| Hero-Stillleben (Tisch, Fläschchen, Pinsel) | ja | ersetzt durch Banner-Komposition |
| Datenschutzseite | ja | nicht gestaltet |
| Dunkles Theme nach Systemeinstellung | `theme-color` vorhanden | als eigenes Artboard entworfen, Kopplung an `prefers-color-scheme` fehlt |

## Was noch fehlt

1. Umsetzung in `docs/index.html` und einem neuen Stylesheet; `docs/assets/sketch.css` und `sketch.js` anpassen oder ersetzen.
2. Figtree (400/500/600/800) als Dateien in `docs/assets/fonts/`, per `@font-face`, ohne externe Anfragen (die Seite wirbt mit „keine Drittanbieter").
3. Die zehn Motive aus dem Design-System nach `docs/assets/` kopieren: hängender Salbeizweig, Knospenzweig, rote Blume mit Olivblättern, Olivbaum, rosa Blüte mit Stiel, weiße Blüten am Stiel, Lavendel, Obstbaum, Zypresse (Strauß ist im Entwurf nicht verbaut). Einbindung mit `<img alt="">`.
4. Englische Texte übernehmen und den EN-Schalter anschließen.
5. Datenschutzseite im selben Stil.
6. Regal-Detail, Umdreh-Karten und Einblendungen: übernehmen oder bewusst streichen.
7. Meta-Daten: `theme-color`, Favicon, `og:`-Tags an die neuen Farben anpassen.
8. `wald` an `prefers-color-scheme` koppeln (Entwurf liegt vor, Umsetzung fehlt).
9. Kontrast, Fokusring und Tastaturbedienung (Tabs) im fertigen HTML prüfen.
10. Entwurf mit echten Motiven und Figtree erneut ansehen.

## Regeln aus dem Design-System, die bei der Umsetzung gelten

- Nur flache Flächen, keine Schatten, keine Verläufe; Tiefe über Tonwerte.
- Hauptaktion in `primary`; `accent` (Koralle) nur als Füllung, Text auf Koralle in `on-accent`.
- Motive nie auf `forest-900` mit dunklem Laub und nie als Bäume auf `sage-300`; Hero bleibt hell.
- Keine Emojis, keine Ausrufezeichen, keine zweite Schrift.
