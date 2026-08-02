# Changelog

Alle nennenswerten Änderungen werden hier dokumentiert.
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.0.0/), Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

---

## [Unreleased]

### Hinzugefügt
- **Android: Sticker und einzelne Fotoslots im Tagebuch**: das Tagebuch-Formular hat jetzt einen Sticker-Picker (analog zum Lack-Picker) und vier einzelne Fotofelder (Finger rechts/links, Daumen rechts/links) statt der bisherigen flachen Foto-Liste — Aufbau und Beschriftung entsprechen `DiaryPage.tsx` im Web. Beim Speichern werden `polishRefs` und `stickerRefs` jetzt aus der aktuellen Auswahl neu gebaut (inklusive Name/Marke/Farbe bzw. Sticker-Farben), zusätzlich zu den bestehenden `polishIds`/`stickers`-Listen — damit landet nichts mehr nur einseitig in einem der beiden Felder. (#145)

### Fixed
- **Android: Sync verlor Sticker und einzelne Finger-Fotos aus Maniküren**: `Manicure` auf Android kannte weder `polishRefs`, `stickers` und `stickerRefs` noch die vier benannten Fotoslots (`fingerRight`/`fingerLeft`/`thumbRight`/`thumbLeft`) — unbekannte Felder wurden beim Sync-Deserialisieren kommentarlos verworfen (`ignoreUnknownKeys = true`), und da der Merge record-level last-write-wins arbeitet, ersetzte jede auf Android bearbeitete Maniküre den vollständigen Web-Datensatz durch eine unvollständige Kopie. Modell um die fehlenden Felder erweitert (Room-Migration `MIGRATION_1_2`, keine `fallbackToDestructiveMigration`), `photos` liest jetzt sowohl das aktuelle Objektformat als auch alte flache Foto-Arrays. Die Oberfläche für Sticker und einzelne Fotoslots bleibt Teil von #139; dieser Fix deckt nur Modell, Persistenz und Sync ab. (#141)
- **Projektseite: die Hand im Lack-Studio war als Hand nicht zu erkennen**: die Handfläche war ein abgerundetes Rechteck, auf das vier identische Finger-Kopien (`#fingerTpl`) geklebt waren — weil jeder Finger seine eigene geschlossene Kontur zeichnete, ließen die Überlappungen dunkle Tintenschlitze zwischen den Fingern stehen, und der Daumen war ein flaches Paddel ohne Daumenballen. Neu gezeichnet als **eine** geschlossene Kontur über Daumen, Ballen, Handgelenk, Handfläche und alle vier Finger, erzeugt aus einem parametrischen Modell; die Zwickel sind Falten statt Schnitte, Knöchel, Gelenkfalten und Sehnen liegen als Strichzeichnung darüber. Farb- und Finish-Umschaltung des Studios unverändert. (#133)
- **Projektseite: die Hero-Illustration zeigte nicht erkennbar, was sie zeigen soll**: der Pinsel bestand aus einem Stiel, einem grauen Kästchen und vier abstehenden Strichen, die Fläschchen schwebten auf unzusammenhängenden Höhen ohne Standfläche, die Kaffeetasse hing mit abgelöster Untertasse in der Ecke, und die Pfeilspitze der Notiz „Lieblingslack" lag hinter dem Fläschchen, auf das sie zeigen sollte. Die Szene steht jetzt vollständig auf einer gezeichneten Tischplatte mit Kontaktschatten; aus dem Eckplatz wurde ein geöffnetes Fläschchen mit gerade herausgezogenem Pinsel, und die Notiz landet wieder auf dem Fläschchen. (#135)

---

## [3.2.0-rc.4] – 2026-07-31

### Hinzugefügt
- **Web-Recherche läuft jetzt auf dem eigenen Server**: statt der kostenpflichtigen Websuche der Anbieter (OpenRouter berechnet ~$0.005 pro Anfrage auch bei einem `:free`-Modell, Gemini-Grounding ist gar nicht im Free-Tier) stellt der Server die Suchanfrage selbst und bietet sie dem Modell als Werkzeug `web_search` an — für beide Wire-Formate (OpenAI-kompatibel und Gemini `functionDeclarations`). Backend wählbar: DuckDuckGo (ohne Einrichtung), eigene SearXNG-Instanz, Brave oder aus. Tool-Aufrufe sind normale Completions, „nur kostenlose Modelle" bleibt damit kostenlos **und** recherchiert. Schlägt die Suche fehl, antwortet die KI aus eigenem Wissen und der Vorschlag wird als ungeprüft gekennzeichnet. (#86)

### Fixed
- **KI: Websuche wurde trotz „nur kostenlose Modelle" abgerechnet**: `plugins:[{id:'web'}]` kostete pro Anfrage, auch auf einem `:free`-Modell, und der Fallback erkannte OpenRouters `403 Key limit exceeded` nicht — der Job starb hart, obwohl unbezahlte Aufrufe auf demselben Key weiterliefen. (#125)
- **KI: Smart-Cart verlangte Belege, die es ohne Websuche nicht geben kann**: der Prompt forderte „nur durch Recherche bestätigte Produkte", während keine Recherche stattfand — das Modell erfand daraufhin plausible Artikelnummern, die als Kaufliste im Warenkorb landeten. Prompts beschreiben jetzt den tatsächlichen Modus, `num` bleibt im Zweifel leer, und ungeprüfte Vorschläge sind markiert. (#126)

---

## [3.2.0-rc.3] – 2026-07-31

### Fixed
- **KI: „nur kostenlose Modelle" hängte `:free` an OpenRouters eigene Router**: `:free` ist ein Variant-Suffix auf einem Provider-Modell (`deepseek/deepseek-r1:free`). OpenRouters eigene Router sind keine Provider-Modelle, das Suffix erzeugte also ungültige IDs wie `openrouter/auto:free` und `openrouter/free:free`. Betroffen waren damit beide realistischen Konfigurationen — der App-Default `openrouter/auto` und `openrouter/free`, OpenRouters eigener Free-Models-Router. Router werden jetzt auf `openrouter/free` abgebildet statt suffigiert; Provider-Modelle behalten die `:free`-Variante, bereits suffigierte IDs bleiben unverändert. (#86)

---

## [3.2.0-rc.2] – 2026-07-31

### Fixed
- **KI: Fallback ohne Websuche, wenn das Suchkontingent fehlt**: alle KI-Funktionen fordern eine Web-Recherche an, aber weder OpenRouter noch Gemini enthalten die Websuche im kostenlosen Kontingent — derselbe Request lief ohne Suche mit 200 durch und mit Suche in einen 429. Auto-Fill und Smart-Cart schlugen damit genau mit den Schlüsseln fehl, mit denen die meisten anfangen, und die Fehlermeldung („Kontingent überschritten") zeigte auf den API-Key statt auf das Such-Add-on. Ein geerdeter Aufruf, der mit 429/402 scheitert, wird jetzt einmal ohne Such-Tool wiederholt und aus dem Modellwissen beantwortet; alle anderen Fehler bleiben unverändert. (#86)

---

## [3.2.0-rc.1] – 2026-07-30

### Sicherheit
- **Android: HTTP-Logging-Interceptor nicht mehr in Release-Builds aktiv**: `ServerAdapter` und `NextcloudAdapter` fügten `HttpLoggingInterceptor(Level.BASIC)` bedingungslos hinzu, wodurch jede Sync-Anfrage auch in Produktions-Builds ins Logcat geschrieben wurde. Bei Nextcloud steckt der Nextcloud-Benutzername in der WebDAV-Basis-URL und wurde damit bei jedem Sync geloggt. Der Interceptor wird jetzt nur noch in Debug-Builds registriert (`BuildConfig.DEBUG`). (#94)
- **systemd-Service läuft nicht mehr als root**: `install.sh` legt jetzt einen dedizierten Systembenutzer `nagellacke` an, dem das komplette Installationsverzeichnis gehört (`User=`/`Group=` in der Unit). Das Selbst-Update (`POST /api/update/apply`) rief bisher `systemctl restart` auf sich selbst auf, was Root-Rechte gebraucht hätte — stattdessen beendet sich der Prozess jetzt einfach selbst (`process.exit(0)`), `Restart=always` in der Unit startet ihn automatisch neu. Ein geleakter oder erratener Admin-API-Key gibt einem Angreifer damit nur noch Rechte innerhalb `/opt/nagellacke`, nicht mehr Root-RCE auf dem Host. (#71)
- **Hinweis**: die Produktionsinstanz wird nicht über `install.sh` deployt, sondern über separates Infrastruktur-Tooling (privates Repo), das die systemd-Unit unabhängig schreibt. Dieser Fix hier deckt den dokumentierten manuellen Install-Weg ab; der Infrastruktur-Teil braucht eine eigene, von einem Menschen geprüfte Änderung (Live-Service, siehe Kommentar auf #71).
- **GitHub Actions auf Commit-SHAs gepinnt**: alle Third-Party-Actions in `.github/workflows/*.yml` (`actions/checkout`, `actions/setup-java`, `actions/setup-node`, `actions/upload-artifact`, `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`, `gradle/actions/setup-gradle`, `anthropics/claude-code-action`) referenzierten bisher mutable Tags (`@v4`, `@v1`, …) statt gepinnter SHAs — ein kompromittiertes Tag hätte unbemerkt anderen Code ausführen können. Jetzt `@<sha> # v<version>`, SHAs gegen die GitHub-API verifiziert. (#78)
- **NodeSource-Setup ohne curl-pipe-bash**: `install.sh` verifizierte das Node.js-20-Setup-Skript bisher nicht und unterdrückte stdout/stderr komplett (`| bash - > /dev/null 2>&1`), was auch einen MITM'ten oder fehlgeschlagenen Download verschleiert hätte. Jetzt NodeSource's dokumentierte signierte-apt-Repo-Methode (GPG-Key holen, `signed-by`-Repo eintragen, `apt-get install`) statt Remote-Skript-Ausführung. (#75)
- **CORS fällt in Produktion nicht mehr unbemerkt auf Wildcard zurück**: `ALLOWED_ORIGIN` defaultete bisher überall auf `"*"` und warnte nur. Server startet jetzt nicht mehr, wenn `NODE_ENV=production` gesetzt ist und `ALLOWED_ORIGIN` fehlt (`install.sh` setzt `NODE_ENV=production` in der systemd-Unit). Lokale Entwicklung (`npm run dev`) bleibt unverändert permissiv. Aktuell nicht ausnutzbar (kein `credentials: true`, Auth ist Header-basiert), aber ein Fail-Closed-Default ist billiger als ein zukünftiges stilles Fehlverhalten. (#76)
- **JWT-Revocation-Mechanismus**: JWTs waren bisher nur über ihr 30-Tage-Ablaufdatum begrenzt — kein Logout, keine Widerrufsliste, einzige Möglichkeit alle Sessions zu invalidieren war ein globaler `JWT_SECRET`-Rotationswechsel (loggt alle User gleichzeitig aus). Jeder Token trägt jetzt eine `tokenVersion`, die bei jeder JWT-Prüfung gegen die aktuell im User-Datensatz gespeicherte Version geprüft wird (`token_version` in `users.json`, neuer `db.ts`-Helper `bumpTokenVersion`). Neuer Endpoint `POST /api/auth/logout-all` (JWT-geschützt) erhöht die Version und invalidiert damit sofort jedes zuvor ausgestellte Token für diesen User — z. B. nach einem verlorenen/gestohlenen Gerät. (#77)
- **API-Key-Vertrauensgrenze dokumentiert**: `/api/update/apply` zieht ungeprüft den aktuellen `origin/main`-HEAD (kein Signatur-/Tag-Pinning) und führt `npm install` inkl. beliebiger `postinstall`-Skripte aus — der `X-Api-Key` ist damit faktisch ein Root-/RCE-Credential, keine normale API-Key. Jetzt prominent in README, CLAUDE.md und im Code selbst dokumentiert. Tag-Pinning statt `main` wäre eine zusätzliche Härtung, ist aber eine bewusste Produktentscheidung und hier nicht umgesetzt. (#73)
- **Pro-Benutzer-Datentrennung**: `getData()`/`setData()` arbeiteten auf einer einzigen globalen `data.json` ohne jeden Benutzerbezug — jedes registrierte Konto las und schrieb dieselbe Sammlung, und `POST /api/sync/push` konnte die Daten eines anderen Kontos ohne Merge und ohne Warnung komplett ersetzen. Sammlungen liegen jetzt unter `data/users/<user>/data.json`, aufgelöst aus dem Benutzernamen im JWT; Benutzernamen werden vor dem Dateisystemzugriff prozent-escaped (`../../etc` bleibt im Datenverzeichnis). Eine bestehende globale `data.json` wird beim Start dem zuerst registrierten Konto zugeordnet und zu `data.json.pre-user-isolation` umbenannt; die Migration ist idempotent. Alle anderen Konten starten leer und müssen von einem Gerät mit lokalen Daten neu syncen. Fotos bleiben bewusst in einem gemeinsamen Verzeichnis. (#87)
- **Kürzere JWT-Laufzeit + Refresh-Flow**: Access-Tokens laufen jetzt nach 7 statt 30 Tagen ab (`JWT_ACCESS_TTL`), dazu ein 30-Tage-Refresh-Token (`JWT_REFRESH_TTL`) und `POST /api/auth/refresh`. Der Web-Client erneuert bei einem 401 transparent und wiederholt die Anfrage einmal. Refresh-Tokens tragen die `tokenVersion`, werden also von `/api/auth/logout-all` mit widerrufen; Access-Tokens sind als `typ: 'access'` markiert und am Refresh-Endpoint abgelehnt. httpOnly-Cookies scheiden aus, weil die Android-App Bearer-Header nutzt und die Web-App cross-origin deploybar ist. (#109)
- **Journal-Zugriff auf die eigene Unit begrenzt**: `install.sh` steckte den Service-Benutzer in die Gruppe `systemd-journal`, was Lesezugriff auf das *gesamte* System-Journal gibt (andere Dienste, Auth-Logs, Kernel) statt nur auf die eigenen Logs. Ersetzt durch eine sudoers-Regel, die exakt den einen `journalctl`-Aufruf des Endpoints erlaubt, vor dem Aktivieren mit `visudo -cf` geprüft wird; die alte Gruppenmitgliedschaft wird beim Update entfernt. (#110)
- **Admin-API-Key rotierbar**: neuer Endpoint `POST /api/admin/api-key/rotate` (mit dem aktuellen Key autorisiert) ersetzt den Schlüssel im laufenden Betrieb, ohne Shell-Zugriff auf den Host. Bewusst kein automatischer Ablauf — der Key ist der einzige Zugang zu den Admin-Endpoints. Ab 180 Tagen weist der Server beim Start auf die Rotation hin; beide Wege sind jetzt im README dokumentiert. (#108)
- **AI-Job-Abfrage auf den Eigentümer beschränkt**: `GET /api/ai/jobs/:id` gab jeden Job an jeden authentifizierten Aufrufer heraus, obwohl ein Job den Smart-Cart-Prompt und die Rechercheergebnisse seines Eigentümers enthält.

### Hinzugefügt
- **Einkaufswagen-Tab mit KI-Assistenz**: neuer Tab für geplante Käufe (Lacke mit `status: 'wish'`), inkl. Hinzufügen aus der bestehenden Sammlung oder als neuer Eintrag, „Gekauft"-Aktion und Löschen mit Undo. Dazu **KI Auto-Fill** (Toggle im Lack-Formular: die KI recherchiert Farbe und Finish im Hintergrund) und **Smart-Cart** (Prompt-Feld, das die Sammlung analysiert, reale Produkte recherchiert und validierte Treffer in den Warenkorb legt). Anbieter wahlweise **OpenRouter** (mit „nur kostenlose Modelle"-Schalter) oder **Gemini / Google AI Studio** direkt, konfigurierbar unter Einstellungen → KI-Assistenz. Hintergrundjobs laufen serverseitig in einer persistierten Queue. (#86)
- **Globaler Schalter zum Abschalten aller KI-Funktionen**: Einstellungen → Darstellung → „KI-Funktionen". Ausgeschaltet werden Auto-Fill-Toggle, Smart-Cart und der komplette KI-Einstellungsbereich gar nicht erst gerendert — nichts wird nur ausgegraut. (#99)
- **Android: Foto-Auswahl in allen drei Formularen**: Lack-, Sticker- und Tagebuch-Formular haben jetzt einen Foto-Picker (Android Photo Picker, ohne Laufzeitberechtigung) mit Vorschau und Entfernen-Button — `PhotoRepository.importPhoto()` war vollständig implementiert, aber von der UI aus nie erreichbar. Die ungenutzte `CAMERA`-Berechtigung wurde aus dem Manifest entfernt. (#89)

### Fixed
- **Android: Hex-Farbwert ohne führendes `#` korrumpierte den Lack-Eintrag**: `isValidHex()` akzeptierte 6-stellige Hex-Werte auch ohne `#`, wurde aber unverändert gespeichert — die Vorschau im Formular normalisierte den Wert zwar korrekt, aber jede andere Stelle (Karten, Statistik, Sticker, Tagebuch), die `polish.color` direkt mit `Color.parseColor()` rendert, warf dabei eine Exception und fiel auf die Default-Farbe zurück. `PolishFormSheet.kt` normalisiert den Wert jetzt beim Speichern (`normalizeHex()` in `domain/Color.kt`), sodass nur noch `#`-präfixierte Werte persistiert/synced werden. (#91)
- **Android**: `AuthorizationService`-Instanzen aus dem OAuth-Sign-in-Flow (`OAuthHelper.kt`, `SettingsScreen.kt`) wurden nie disposed, wodurch jeder Anmeldeversuch (auch wiederholte, z.B. nach einem OAuth-Fehler) eine gebundene Custom-Tabs-Service-Verbindung leakte. Beide Stellen rufen `dispose()` jetzt, sobald der jeweilige Service nicht mehr gebraucht wird. (#95)
- **CORS blockierte cross-origin DELETE/PATCH**: `@fastify/cors` setzt `methods` per Default auf die Zeichenkette `'GET,HEAD,POST'` und leitet sie *nicht* aus den registrierten Routen ab. Jeder Preflight meldete daher nur diese drei Methoden, sodass Browser `DELETE /api/photos/:filename` und `PATCH /api/auth/me` gar nicht erst abschickten, sobald Web-App und API auf verschiedenen Origins laufen (GitHub Pages oder eine „Eigener Server"-URL auf einem anderen Host). Sichtbar wurde das nur als still verwaiste Fotodateien auf dem Server. (#112)
- **„Wochenbericht" statt „Wochesbericht"**: `${periodLabel}sbericht` baute das Kompositum über ein gemeinsames „s" — für „Monatsbericht" korrekt, für die Wochenausgabe falsch. Betraf Server- und Web-Report-Generator, also E-Mail-Report, In-App-Vorschau und PDF-Export. (#114)
- **Schnell aufeinanderfolgende Löschungen verloren die Foto-Bereinigung**: eine zweite Löschung innerhalb des 3-Sekunden-Undo-Fensters ersetzte den Snackbar-State und verwarf dabei die `commitFn` des ersten Eintrags, dessen Foto damit dauerhaft auf dem Server verwaiste. Der ausscheidende Snack gilt jetzt als implizit bestätigt und seine Bereinigung wird vorher ausgeführt. (#113)
- **Android: Bearbeiten verwarf Felder, die im Formular fehlen**: Lack-, Sticker- und Tagebuch-Formulare bauten beim Speichern ein komplett neues Objekt, wodurch `count`, `photos` und `photo` auf ihre Defaults zurückfielen. Sie kopieren jetzt den bestehenden Eintrag und überschreiben nur die tatsächlich bearbeiteten Felder. (#115)
- **Android: Sync-Schreibfehler wurden ignoriert, OAuth-Tokens nie erneuert**: kein Adapter prüfte `response.isSuccessful` nach dem Upload, und ein fehlgeschlagener *Lesevorgang* fiel auf „local wins" zurück — ein abgelaufenes Token konnte die Remote-Daten so still mit dem lokalen Stand überschreiben, während die UI Erfolg meldete. Schreibvorgänge werden jetzt geprüft, nur ein echtes „noch nicht vorhanden" darf als leerer Remote-Stand durchgehen, und die drei OAuth-Provider erneuern ihr Access-Token über den gespeicherten Refresh-Token. (#116)
- **Android: Sync verwarf parallele lokale Änderungen**: `syncNow()` überschrieb Room nach dem Netzwerk-Roundtrip mit dem Snapshot von *vor* der Anfrage. Der lokale Stand wird jetzt erneut gelesen und eingemischt. (#88)
- **Android: Fotos nur beim Provider „Server" sichtbar**: `photoBaseUrl()` gab für alle anderen Provider `null` zurück. Foto-URLs werden jetzt über den jeweiligen Adapter aufgelöst (Server, Nextcloud, OneDrive, Dropbox, inkl. nötigem Auth-Header); Google Drive braucht ein asynchrones File-ID-Lookup und zeigt stattdessen einen expliziten „nicht unterstützt"-Hinweis statt still auf die Flaschengrafik zurückzufallen. (#90)

---

## [3.1.1] – 2026-07-11

### Sicherheit
- **Path Traversal in `DELETE /api/photos/:filename` geschlossen**: der Dateiname wurde ungeprüft in einen Dateisystempfad eingesetzt, wodurch `../`-Sequenzen Zugriff außerhalb des Foto-Verzeichnisses erlaubten. (#46)
- **Rate-Limiting auf Login verschärft**: `@fastify/rate-limit` ersetzt die bisherige Eigenimplementierung und schließt eine Brute-Force-Lücke beim Login. (#50)
- **Dependabot #20 (esbuild dev-server arbitrary file read, GHSA-g7r4-m6w7-qqqr) geprüft, kein Fix möglich**: `esbuild@0.27.7` kommt transitiv über `vite@8.1.4` und `tsup@8.5.1` (`v3/package-lock.json`). Ein `overrides`-Zwang auf `esbuild@^0.28.1` löst den Advisory zwar auf, bricht aber `npm run build:web` — vite 8s internes rolldown-Bundling ist an seine gepinnte esbuild-Version gekoppelt und wirft beim Build (`rolldown-build-*.mjs`, `Object.build`). Betrifft nur den Dev-Server (`vite dev`/`tsup`/`tsx`), nie den Produktions-Build. Alert bis zu einem vite-Patch-Release mit esbuild ≥0.28.1 als "no fix available" dismissen. (#48)
- **CI**: `android-release`-Workflow auf Least-Privilege-Permissions umgestellt. (#47)

### Fixed
- **Web sync never triggered**: logging in via "Eigener Server" only stored the JWT in local React state, never in the persisted `SyncConfig` — `useAppData.sync()` reads from `localStorage`, so `ServerAdapter` threw on missing `serverToken` (silently swallowed) and no `/api/sync` request ever fired after login or "Jetzt syncen". Login now persists the token and triggers an immediate sync. Also fixes the "Eingeloggt" state not surviving a page reload. (#41)
- **Spurious sync error after logout**: logout used to persist an empty `serverToken` instead of clearing the sync config, so the next page load's auto-sync threw and showed a "Sync-Fehler" banner even though the user intentionally logged out. Logout now clears the persisted config entirely.
- **Nextcloud-Sync-Warnung**: Hinweis in den Sync-Einstellungen, das eigene Nextcloud-Konto-Passwort nicht direkt zu verwenden. (#52)
- **Android Release-Build**: R8-Minification schlug fehl (`Missing class com.google.errorprone.annotations.Immutable`, transitiv über Tink/`androidx.security.crypto`) — `-dontwarn`-Regel ergänzt. (#53)
- **Android**: Sync-Anbieter-Auswahl in den Einstellungen rendierte kaputt — die Chip-Row hatte keinen Scroll-Modifier, wodurch bei 5 Anbietern die letzten Chips als leere, überlange Pillen dargestellt wurden. Jetzt horizontal scrollbar. (#56)
- **Web**: "Speichern" im Lack-Formular reagierte bei leerem Namen ohne jede Rückmeldung — zeigt jetzt eine sichtbare Validierungsmeldung statt still nichts zu tun. (#57)
- **Web**: Zähler ("1 Lacke", "1 Einträge") verwenden jetzt die korrekte Singular-/Pluralform. (#58)
- **CI**: `claude-review` GitHub Action refused to run whenever `claude[bot]` pushed a follow-up commit to a PR it opened, failing with "Workflow initiated by non-human actor". Added `allowed_bots: 'claude[bot]'`.

### Changed
- **Major Dependency-Updates** für Server und Web: Fastify 4 → 5 (inkl. CVE-2026-33806-Fix), Vite 5 → 8, Vitest 1 → 4, sowie zugehörige `@fastify/*`-Plugins und `uuid` 9 → 11. (#37)

### Added
- **Play-Store-Release-Infrastruktur** für Android: Signing-Config (env-var-gated), `android-release`-Workflow für `android-v*`-Tags, Datenschutzerklärungs-Entwurf. (#38)

---

## [3.1.0] – 2026-06-20

### Added
- **Weekly/monthly reports**: Beautiful self-contained HTML report with cover page, statistics (top finishes, top brands), new polish cards, new sticker cards, and a manicure diary. Opens in a new tab → Ctrl+P → Save as PDF.
- **Email delivery**: Send a report directly from Settings via SMTP. Configure via `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`; optional `SMTP_PORT`, `SMTP_FROM`, `APP_URL`.
- **Automatic scheduler**: Weekly (every Monday 08:00 UTC) or monthly (1st of month 08:00 UTC) automatic email. Configurable under Settings → Berichte.
- **New JWT-protected server endpoints**: `GET /api/auth/me`, `PATCH /api/auth/me`, `GET /api/reports/preview`, `POST /api/reports/send` (rate-limited 10/hr), `GET /api/reports/schedule`, `POST /api/reports/schedule`.
- Server-side report generator uses absolute photo URLs via `APP_URL` env var so images render correctly in email clients.

### Fixed
- Report email requests use Bearer token even when an API key is also stored in localStorage — avoids 401 on JWT-only endpoints.
- SMTP errors return a sanitised 502 to the client instead of leaking raw SMTP error messages.
- ISO date strings parsed as local midnight to avoid off-by-one week in UTC-negative timezones.
- Disabling the report schedule no longer overwrites the stored recipient email address.

---

## [3.0.4] – 2026-06-17

### Sicherheit
- **Auth-Bypass geschlossen**: `requireApiKey` / `requireJwt` / `requireApiKeyOrJwt` fehlten `return` vor `reply.send()` — Fastify-Lifecycle konnte nach 401 weiterlaufen (K-2)
- **Rate-Limiting repariert**: `request.routerPath` war in Fastify 4 `undefined` → alle Routes teilten ein Bucket (H-1)
- **Foto-Upload: Body-Limit auf 15 MB** angehoben; Fastify-Default (1 MB) hat Handy-Fotos blockiert (H-5)
- **CORS-Warning** beim Start wenn `ALLOWED_ORIGIN` nicht gesetzt; `install.sh` enthält nun Platzhalter mit Hinweis (H-4)

### Behoben
- **React-Hook-Crash**: `useMemo` in NailBottle stand nach Early-Return → "Rendered fewer hooks" beim Foto-Toggle (K-1)
- **Datenverlust**: v2-Maniküreeinträge mit `polishes: string[]` hatten beim Bearbeiten leere Lackauswahl (H-3)
- **Sync-Push**: Fehlgeschlagener Push meldete trotzdem `success: true` (H-2)
- **Orphan-Fotos**: Gelöschte Lacke/Sticker/Maniküren räumen ihre Fotos jetzt serverseitig auf (M-4)
- **hexToHue**: Kurze Hex-Codes (`#fff`), leere Strings und `rgba()`-Werte crashten die Farbsortierung (M-3)
- **SVG-Gradient-IDs**: `Math.random()` erzeugte bei jedem Render neue IDs → Gradients in StrictMode instabil (M-1)
- **git pull --autostash** in `install.sh` verhindert Fehler bei lokalen Änderungen (L-11)
- Korrupte `data.json`/`users.json` werden jetzt geloggt statt still ignoriert (L-12)

### Hinzugefügt
- **Undo-Snackbar**: Löschen von Lacken, Stickern und Tagebucheinträgen ist 3 Sekunden lang rückgängig machbar (K-4)
- **Leere-Zustände**: Kollektion, Sticker, Tagebuch zeigen freundliche Meldung bei 0 Einträgen (H-8)
- **Sync-Fehler-Indikator**: Roter Punkt auf „◈ Mehr"-Button wenn Auto-Sync fehlschlägt (H-9)
- **Such-Clear-Button**: × in Kollektion- und Sticker-Suche (H-10)

### Barrierefreiheit / UX
- Alle drei Modals: `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape-Taste, Focus-Trap (K-5)
- Modal-Schließ-Buttons: `aria-label="Schließen"` (K-6)
- Delete-Buttons auf Touch-Screens sichtbar (`@media hover:none`, Opacity 55 %) (K-3)
- Karten, Tagebucheinträge, Sticker-Items per Tastatur erreichbar (`role="button"`, `tabIndex`, `onKeyDown`) (M-2)
- Nav-Pills auf Mobilgeräten ≥ 44 px Höhe; kein Overflow auf 320-px-Screens (H-6)
- WCAG-AA-Kontrast: `appSubtitle`, `navBtn`, Placeholder, `.count`, `.brand` angehoben (H-7)
- Filter-Selects und Such-Inputs mit `aria-label` (H-10, H-11)
- Stern-Bewertung: `role="group"`, `aria-label`, `aria-pressed` (M-8)
- Nur noch ein `<h1>` pro Seite (App-Titel); Seitentitel auf `<h2>` geändert (M-6)
- Import-Button als echtes `<button>` statt `<label>` (M-11)
- `confirm()` / `alert()` in Settings durch Inline-Dialoge ersetzt (M-5)
- `aria-required` + Hilfstext für Nextcloud-App-Token (M-12)
- `aria-live`-Region für Login-Status in Settings (M-9)
- Focus-visible-Ringe auf Nav-Buttons und Formular-Inputs (L-2, L-3)
- `background-attachment: fixed` entfernt (iOS Safari Repaints) (L-1)
- Alle Schließen-Icons auf `✕` (U+2715) vereinheitlicht (L-10)

---

## [3.0.1] – 2026-06-03

### Geändert
- Interne Version auf 3.0.1 angehoben; Update-Check-Testrelease zur Verifikation der Update-Pipeline

---

## [3.0.0] – 2026-06-03

### Hinzugefügt
- **Native Android-App** (Expo React Native ~51, React Native 0.74, Expo Router, Material Design 3)
- Fünf Tabs: Lacke, Sticker, Tagebuch, Statistik, Mehr
- Play-Store-Build via EAS (Package-ID `de.nagellacke.app`)
- Datenpersistenz: `expo-file-system`; Sync-Config: `expo-secure-store` (verschlüsselt)
- Primärfarbe Pink (`#c2185b`), Light + Dark Mode
- Android-Permissions: Kamera, Storage, Internet

---

## [2.2.9] – 2026-06-02

### Behoben
- JWT-Auth für alle Admin-Endpunkte (`/api/update/check`, `/api/update/apply`, `/api/logs`) einheitlich durchgesetzt
- Update-Check im v3-Server: 10-Sekunden-Timeout verhindert hängende GitHub-API-Anfragen

---

## [2.2.8] – 2026-06-02

### Geändert
- `POST /api/data` akzeptiert jetzt alternativ JWT (Bearer Token) statt nur API-Key — ermöglicht Hybrid-Betrieb für v2-PWA und v3-Clients gleichzeitig

---

## [2.2.7] – 2026-06-02

### Behoben
- Sync-sichere IDs für alle Items: `generateId()` (Timestamp + 5-stelliger Zufallsstring) ersetzt `Date.now()` als alleinigen Identifier
- Backfill beim Laden: Items ohne `id`-Feld erhalten beim Serverstart automatisch eine stabile ID

---

## [2.2.6] – 2026-06-02

### Hinzugefügt
- **SyncPanel** in der v2-Oberfläche: Cloud-Sync direkt in der Web-UI konfigurierbar (Server-URL, Username, Passwort)
- Sync-Endpunkte `/api/auth/register`, `/api/auth/login`, `/api/sync` im v3-Server

### Behoben
- Update-Pipeline deployt jetzt die v3-Web-App (`apps/web/dist`) statt des alten v2-Frontends
- Upgrade-auf-v3-Button wird ausgeblendet, wenn v3 bereits installiert ist

---

## [2.2.5] – 2026-06-02

### Geändert
- Interne Version auf 2.2.5 angehoben; `backend/package.json` und `server.js` synchronisiert

---

## [2.2.4] – 2026-06-02

### Behoben
- v3-Installer: Nginx-Timeout-Problem bei langen Build-Vorgängen behoben; verbessertes Fehler-Feedback
- Service-Worker: Cache-Name-Versioning stellt sicher, dass neue Releases alte Assets ersetzen
- A11Y-Fixes in mehreren Komponenten

---

## [2.2.3] – 2026-06-02

### Behoben
- Service-Worker: Race-Condition beim Cache-Update nach Neustart beseitigt
- Export: Toast-Feedback bei erfolgreichem Export

---

## [2.2.2] – 2026-06-02

### Geändert
- Upgrade-auf-v3-Button direkt ins `UpdatePanel` integriert (kein separates Component mehr nötig)

---

## [2.2.1] – 2026-06-02

### Behoben
- Export: ArrayBuffer-Bug beim base64-Einbetten von Fotos in die JSON-Datei behoben
- V3UpgradePanel wird wieder korrekt gerendert und ist sichtbar

---

## [2.2.0] – 2026-06-02

### Hinzugefügt
- **v3 Sync-Server** als eigenständiges Ziel neben v2 (Fastify + TypeScript, npm-Workspace-Monorepo)
- **Upgrade-Pfad v2 → v3**: automatische Datenmigration (data.json + Fotos + API-Key), kein manueller Eingriff nötig
- Monorepo-Pakete: `@nagellacke/core` (Typen, Logic, Merge-Algorithmus), `@nagellacke/sync` (5 Sync-Adapter)
- Sync-Adapter: Server (JWT), Google Drive, OneDrive, Nextcloud (WebDAV), Dropbox

### Behoben
- Export: alle Fotos werden korrekt base64-eingebettet (ArrayBuffer-Fix)

---

## [2.1.9] – 2026-05-29

### Hinzugefügt
- Statistiken: Sticker-Auswertung (nach Typ, nach Marke)
- Statistiken: Tagebuch-Auswertung (häufigste verwendete Lacke, häufigste verwendete Sticker)
- Aktive View (Nagellack / Sticker / Tagebuch / Stats) wird nach Browser-Refresh wiederhergestellt (`localStorage`)

### Behoben
- Filter-Leiste nur noch in der Nagellack-Ansicht sichtbar, nicht in anderen Tabs
- Bearbeiten von Tagebuch-Einträgen war nicht möglich

---

## [2.1.8] – 2026-05-29

### Geändert
- Tagebuch: **4 Foto-Slots** pro Eintrag (Finger rechts, Finger links, Daumen rechts, Daumen links)
- `photos`-Objekt (`{fingerRight, fingerLeft, thumbRight, thumbLeft}`) ersetzt das alte einzelne `photo`-Feld
- Rückwärtskompatibilität: alte Einträge mit `photo`-Feld werden automatisch migriert

---

## [2.1.7] – 2026-05-29

### Geändert
- **PhotoPicker** (Kamera/Galerie-Dropdown) einheitlich in PolishForm: sowohl Farbpicker-Foto als auch Flaschenfoto nutzen den gleichen Picker

---

## [2.1.6] – 2026-05-29

### Behoben
- Kamera-Input auf Android öffnete sich nicht: Foto-Inputs von `display:none` auf opacity-basiertes Hiding umgestellt (`position:absolute; width:0.1px; opacity:0`)
- `.click()` wird vor `setOpen(false)` aufgerufen — korrekte User-Gesture-Behandlung auf Android erforderlich

---

## [2.1.5] – 2026-05-29

### Hinzugefügt
- Fehler-Feedback (Toast) bei fehlgeschlagenem Foto-Upload

### Geändert
- PhotoPicker (Kamera/Galerie-Dropdown) auch in `StickerPage` und `DiaryPage` einheitlich eingesetzt
- `type="button"` auf alle expliziten Buttons in `StickerFormFields` gesetzt (verhindert unbeabsichtigtes Form-Submit)

### Behoben
- API-Schlüssel-Warnung in Sticker-Formularen fehlte

---

## [2.1.4] – 2026-05-28

### Geändert
- Sticker: Foto wird standardmäßig angezeigt (war vorher ausgeblendet)
- Farb-Editor: „Mehrfarbig"-Option hinzugefügt (Regenbogen-Gradient als visuelles Indikator)
- PolishForm: Foto-Farbpicker auf einen Button reduziert — nativer Android-Chooser öffnet sich

---

## [2.1.3] – 2026-05-28

### Behoben
- Mobile Nav-Overlap: `.header-nav` CSS-Klasse statt Inline-`marginLeft:auto`; Media-Query überschreibt auf Mobilgeräten zu voller Breite und Linksbündigkeit

---

## [2.1.2] – 2026-05-28

### Behoben
- Update-Polling: erkennt Server-Downtime via `downCount`; Fallback-Hard-Reload nach 45 Sekunden (statt lautlosem Hängen)

---

## [2.1.1] – 2026-05-28

### Geändert
- Nav-Label „Nagellack" statt „Kollektion"

### Behoben
- Mobile Nav-Layout (Header-Überlappung)
- Update-Cache-Fix: `localStorage` wird vor dem Update-Apply geleert, damit der SW sofort die neue Version lädt
- Sticker-Auswahl im Tagebuch-Formular funktioniert wieder

---

## [2.1.0] – 2026-05-28

### Hinzugefügt
- **Nail-Sticker-Inventar**: neuer Nav-Tab „Sticker"
- Felder: Name, Marke, Stil (Freitext mit Vorschlägen), Typ (6 Optionen: Full Cover, Akzent, Nail Wrap, 3D, Folie, Slider), Farben (Multi-Color-Editor, bis 10 Farben, Hex + Transparent-Option), Status, Bewertung, Foto, Notizen
- `data.stickers`-Array in `data.json` (automatische Migration älterer Daten)

---

## [2.0.0] – 2026-05-28

### Hinzugefügt
- **Flaschenfoto** pro Lack: Foto hochladen via Kamera oder Galerie; Canvas-Resize auf max. 800×600 px → Base64 → `data/photos/`
- Foto-Toggle auf der Karte: zwischen SVG-Grafik und echtem Foto umschalten (alle 4 Karten-Layouts)
- **Maniküre-Tagebuch**: neue dritte View mit Einträgen (Datum, Lacke aus Kollektion, Notizen, optionales Foto)
- Navigation auf 3 Buttons erweitert (Nagellack / Tagebuch / Statistiken)
- Backend: `POST /api/photos` (Upload) und `DELETE /api/photos/:filename` (Löschen)
- `data.manicures`-Array in `data.json`

---

## [1.9.0] – 2026-05-28

### Hinzugefügt
- **Code-Split**: `App.jsx` aufgeteilt in `themes.js`, `constants.js`, `utils.js` und 5 Komponentendateien
- **Timestamps**: `createdAt`/`updatedAt` pro Lack; neue Sortieroptionen „Neueste zuerst" / „Älteste zuerst"
- **Batch-Erweiterung**: Marke, Finish und Kategorie im Stapel-Modus setzen
- **Import-Merge-Modus**: beim Import wählbar zwischen „Ersetzen" (alles überschreiben) und „Zusammenführen" (bestehende Daten behalten)
- **PWA**: `manifest.json`, Service Worker (Cache-First-Strategie, `/api/` ausgenommen), SVG-Icons (192 + 512 px)

---

## [1.8.0] – 2026-05-27

### Hinzugefügt
- **Tastatur-Shortcuts**: `/` oder `f` für Suche, `n` für Neuer Lack, `Esc` zum Schließen
- **Theme „System"**: folgt automatisch `prefers-color-scheme: dark`
- **Duplikat-Detektor**: warnt beim Anlegen eines neuen Lacks, wenn ein Lack mit ähnlichem Farbton (±15° Hue) und gleichem Finish bereits existiert
- **Update-Check-Cache**: Ergebnis wird 10 Minuten gecacht (verhindert GitHub-Rate-Limit bei häufigem Öffnen der Einstellungen)

### Behoben
- `PolishForm`-Key-Bug: Formular zeigte beim erneuten Öffnen manchmal Werte des vorherigen Lacks

---

## [1.7.3] – 2026-05-27

### Hinzugefügt
- **Accessibility**: `aria-live`, `aria-atomic`, `aria-expanded`, `aria-pressed`, `aria-current`, `aria-label` auf allen interaktiven Elementen; Fokus-Ringe; Landmark-Elemente (`<main>`, `<nav>`, `<header>`); `htmlFor`/`id`-Verbindungen bei Labels

### Behoben
- Kontrast-Fixes in allen 6 Themes (WCAG AA erfüllt)
- Rating-Bug: Sternebewertung wurde beim Öffnen des Bearbeitungsformulars nicht korrekt vorbelegt

---

## [1.7.2] – 2026-05-27

### Hinzugefügt
- **Sternebewertung** (1–5 Sterne) pro Lack; Sortierung nach Bewertung; Top-Bewertet-Liste in den Statistiken
- Farbklick in der Statistik-Farbpalette: springt direkt zum entsprechenden Lack in der Kollektion und selektiert ihn

---

## [1.7.1] – 2026-05-27

### Geändert
- Theme-spezifische **Karten-Layouts**: Flasche (bottle), Blob, Stripe (horizontal, einspaltig), Row (Liste)
- Theme-spezifische **Filter-Layouts**: Pills, Underline, Block-Glow

---

## [1.7.0] – 2026-05-27

### Hinzugefügt
- **Theme-Switcher**: 6 vollständige Designs mit eigenen Fonts, Farb-Tokens, Border-Radii und Shadows
  - Dark Luxury (Standard), Candy Pop, Warm Vintage, Neon Nightclub, Clean White, Forest Dark
- Theme-Auswahl in `localStorage` gespeichert

---

## [1.6.2] – 2026-05-27

### Behoben
- Kamera-Button öffnet auf Mobilgeräten direkt die Rückkamera (`capture="environment"` Attribut)

---

## [1.6.1] – 2026-05-27

### Hinzugefügt
- **Foto-Farbpicker**: Bild mit Kamera aufnehmen oder aus Galerie laden, auf eine Stelle tippen → Farbe wird direkt ins Farbfeld übernommen (Canvas API `getImageData`)

---

## [1.6.0] – 2026-05-27

### Hinzugefügt
- **API-Key-Authentifizierung**: alle Schreiboperationen erfordern `X-Api-Key`-Header
- Automatische Key-Generierung beim ersten Start (`crypto.randomBytes(24)`), Datei-Mode 0o600
- **In-Memory Rate-Limiting** ohne externe Bibliothek: IP-basiert, verschiedene Limits pro Route
- **Magic-Bytes-Validierung** für Foto-Uploads (JPEG/PNG/WebP erkennbar; kein MIME-Type-Spoofing)
- **Atomic Write** für `data.json`: schreibt zuerst in `.tmp`, dann `fs.renameSync` → kein korruptes File bei Absturz

---

## [1.5.0] – 2026-05-27

### Hinzugefügt
- **Eigene Kategorien**: direkt im Bearbeitungsformular anlegen und löschen
- **Notizen**: Freitext-Feld pro Lack (Kaufdatum, Bewertung, Erinnerungen)
- **Stapelaktionen (Batch-Modus)**: mehrere Lacke gleichzeitig auswählen und Status setzen oder löschen
- **Undo**: Löschungen 5 Sekunden lang rückgängig machen
- **Export / Import**: vollständiges Backup als JSON (alle Felder)
- Erweiterte Sortieroptionen

---

## [1.4.0] – 2026-05-27

### Hinzugefügt
- **15 Finish-Typen** mit Icons: Classic, Shimmer, Glitter, Metallic, Chrome, Matte, Satin, Duochrome, Holographic, Jelly, Neon, Magnetic, Gel Look, Top Coat, Base Coat
- **36 Marken-Vorschläge** (Autocomplete im Formular)
- Dynamische Filter nach Finish und Kategorie

---

## [1.3.0] – 2026-05-27

### Hinzugefügt
- **Statistiken-Seite**: Übersicht nach Marken, Finish-Typen, Status, Kategorien und Farbpalette (nach Farbton sortiert)

---

## [1.2.0] – 2026-05-27

### Geändert
- **Multi-Brand-Support**: Marke als eigenes Feld (vorher war alles im Namensfeld)

---

## [1.1.0] – 2026-05-26

### Hinzugefügt
- **System-Log-Viewer**: `journalctl`-Ausgabe live in der App abrufbar (GET `/api/logs`)

---

## [1.0.0] – 2026-05-26

### Hinzugefügt
- Erste Version: Lacke anlegen, bearbeiten, löschen mit Name, Farbe (Hex-Picker) und Status
- Suche nach Name
- **In-App-Update-System**: GitHub-API-Check + `git pull` + `npm run build` + `systemctl restart` per Knopfdruck
- `install.sh`: Einzeilen-Installer für Debian/Ubuntu (Node.js 20, systemd-Service, Port 3000)
- Automatischer Neustart bei Absturz (`Restart=always` in systemd)
