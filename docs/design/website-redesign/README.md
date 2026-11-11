# Entwurfs-Quellen der Projektseite

Quellcode der beiden Design-Artboards aus `docs/website-redesign.md` (Issue #443).

| Datei | Inhalt |
| --- | --- |
| `startseite-hell.dc.html` | Startseite, Theme `creme` |
| `startseite-dunkel.dc.html` | Startseite, Theme `wald` |
| `tokens.css` | Farben, Schrift, Abstände, Radien aus dem Design-System Flower-Designs |

## Zum Lesen und Umsetzen

- Das Format `.dc.html` ist das Artboard-Format des Design-Editors. Es braucht dessen Laufzeit (`support.js`) und läuft nicht direkt im Browser. Als Vorlage für Markup, Abstände und Texte ist es lesbar.
- Die Pflanzenbilder stehen als `/_blob/<id>`-Adressen im Editor. Diese Adressen gibt es hier nicht. Die Motive stammen aus dem Design-System (Gruppen Blüten, Blätter, Bäume) und kommen bei der Umsetzung als SVG nach `docs/assets/`.
- `tokens.css` verweist auf `fonts/Figtree-*.woff2`; die Schriftdateien liegen nicht im Repo (siehe Liste „Was noch fehlt").
- Die Komponentenklassen `fd-*` (Button, Tag, Card, Hero) stammen aus `bundle.css` des Design-Systems und sind hier nicht enthalten.
- Beide Artboards sind getrennte Kopien; Änderungen an einer müssen in der anderen nachgezogen werden.
