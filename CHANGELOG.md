# Changelog

Kurze Übersicht der wichtigsten Änderungen.

---

## 01/2026

### Resume-Funktion für Anreicherung
- **Fortschritt wird automatisch gespeichert** im Browser (localStorage)
- Bei Netzwerkfehler oder Computer-Schlaf: **Fortsetzen** statt Neustart
- "Neu starten" Button um von vorne zu beginnen
- Anzeige des gespeicherten Fortschritts mit Zeitstempel

### 80/20 Themenliste (LLM)
- Top 15 **Themen** statt einzelner Fragen, Fokus auf Konzepte
- LLM-basierte Analyse mit Lernzielen und Begründungen
- Kein nutzloser Heuristik-Fallback mehr; klare Fehlermeldung, wenn LLM nicht verfügbar

### Karten-Anreicherung: Struktur & Originalerhalt
- **Bewertungstabelle**: Aussage | Richtig/Falsch | Begründung (MC-Fragen)
- **Zusammenfassung** als Take-Home-Message
- **Original-Frage, Q1–Q5, Binärcode** bleiben erhalten und werden klickbar/lesbar angezeigt
- Binärcode-Anzeige: Grün (✓) / Rot (✗) pro Option; Leerzeichen im Code werden ignoriert

### Export: Anreicherung in Original-Karten (Option A)
- **Keine neuen Karten** mehr; Anreicherung wird ins **Sources-Feld** der bestehenden Karten geschrieben
- KPRIM/MC-Format (Question, Q_1–Q_5, Answers) bleibt unverändert
- Lösung, Tabelle, Zusammenfassung, Eselsbrücke, Referenz, Hinweis landen im Sources-Feld

---

*Ältere Änderungen sind in den Commits nachvollziehbar.*
