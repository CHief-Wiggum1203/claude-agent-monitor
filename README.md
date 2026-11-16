# agent-monitor

Ein Claude-Code-Mod: ein Panel **„Agenten live“** neben dem Chat, das live zeigt, was der Hauptagent und seine Subagenten gerade tun.

- Hauptagent und Subagenten als Baum, jeder mit eigenem farbigem Pixel-Logo
- Status (läuft, fertig, Fehler, abgebrochen, wartet), Laufzeit und Anzahl Tool-Aufrufe
- die gerade laufenden Tools mit kurzem Detail (Befehl, Datei, Suchmuster)
- Reiter **Dateien**: jede Datei, die seit dem letzten Prompt gelesen, bearbeitet oder geschrieben wurde, mit den Logos der Agenten, die sie angefasst haben; geänderte Dateien zuerst, abgelehnte oder fehlgeschlagene Aufrufe zählen nicht
- **Konflikt-Warnung:** ändern zwei Agenten dieselbe Datei, wird sie rot markiert, der Reiter bekommt ein ⚠ und es kommt eine Meldung
- **Meldung**, sobald ein Subagent fertig ist oder scheitert, auf Wunsch mit kurzem Ton
- **Statuszeile** „● 2 Agenten laufen · 0:42“, auch bei geschlossenem Panel
- **Verlauf:** die letzten Prompts bleiben einklappbar unter „Frühere Prompts“ stehen, mit ihren Agenten und Dateien
- **Hängt-Erkennung:** ein Tool-Aufruf, der zu lange läuft, wird gelb mit „⏳ seit 2:05“ markiert
- `/agenten` öffnet das Panel wieder

## Einstellungen

| Option | Standard | Bedeutung |
| --- | --- | --- |
| `sound` | aus | Ton, wenn ein Subagent fertig ist oder scheitert (macOS) |
| `historySize` | 5 | wie viele frühere Prompts stehen bleiben (0 = keine) |
| `stallSeconds` | 120 | ab wann ein Tool-Aufruf als „hängt vielleicht“ gilt (0 = nie) |

Setzen lassen sie sich beim Installieren oder später in `/config`.

Braucht Claude Code 2.1.325 oder neuer.

## Installieren

Am Prompt einer Terminal-Session:

```
/plugin install agent-monitor --marketplace CHief-Wiggum1203/claude-agent-monitor
```

`y` bestätigt den Marketplace, dann einen Scope wählen.

Aus einer Shell:

```bash
claude plugin install agent-monitor --marketplace CHief-Wiggum1203/claude-agent-monitor
```

In der Desktop-App: neben dem Prompt auf **+** klicken, dann **Plugins**, **Add marketplace** mit `CHief-Wiggum1203/claude-agent-monitor`, dann **Add plugin**.
