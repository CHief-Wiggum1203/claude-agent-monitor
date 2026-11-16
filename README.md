# agent-monitor

Ein Claude-Code-Mod: ein Panel **„Agenten live“** neben dem Chat, das live zeigt, was der Hauptagent und seine Subagenten gerade tun.

- Hauptagent und Subagenten als Baum, jeder mit eigenem farbigem Pixel-Logo
- Status (läuft, fertig, Fehler, abgebrochen, wartet), Laufzeit und Anzahl Tool-Aufrufe
- die gerade laufenden Tools mit kurzem Detail (Befehl, Datei, Suchmuster)
- Reiter **Dateien**: jede Datei, die seit dem letzten Prompt gelesen, bearbeitet oder geschrieben wurde, mit den Logos der Agenten, die sie angefasst haben; geänderte Dateien zuerst, abgelehnte oder fehlgeschlagene Aufrufe zählen nicht
- fertige Subagenten und die Dateiliste fangen beim nächsten Prompt von vorn an
- `/agenten` öffnet das Panel wieder

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
