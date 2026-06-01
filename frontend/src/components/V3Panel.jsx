import { useState, useEffect } from "react";

export function V3Panel({ t, apiKey }) {
  const [status, setStatus]     = useState(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [logs, setLogs]         = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [done, setDone]         = useState(false);

  const headers = { "X-Api-Key": apiKey || "" };

  const fetchStatus = () =>
    fetch("/api/v3/status", { headers })
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(() => {});

  useEffect(() => { fetchStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const install = () => {
    setBusy(true); setError(""); setDone(false);
    fetch("/api/v3/install", { method: "POST", headers })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); }
        else { setDone(true); fetchStatus(); }
      })
      .catch(e => setError(e.message))
      .finally(() => setBusy(false));
  };

  const fetchLogs = () => {
    setShowLogs(true);
    fetch("/api/v3/logs?lines=60", { headers })
      .then(r => r.json())
      .then(d => setLogs(d.logs || "Keine Logs verfügbar."))
      .catch(() => setLogs("Fehler beim Laden der Logs."));
  };

  const s = {
    wrap:    { textAlign: "center", padding: "0 0 24px" },
    row:     { display: "inline-flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center" },
    text:    { fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase" },
    btn:     { background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.textVeryMuted, padding: "4px 14px", borderRadius: t.filterRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" },
    btnGold: { background: "transparent", border: "1px solid rgba(255,210,60,0.45)", color: "rgba(255,210,60,0.75)", padding: "4px 14px", borderRadius: t.filterRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase" },
    label:   { ...{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase" }, color: t.textFaint },
    logsBox: { fontFamily: "monospace", fontSize: "11px", lineHeight: "1.5", whiteSpace: "pre-wrap", textAlign: "left", padding: "12px", background: t.dark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.06)", borderRadius: "8px", maxHeight: "200px", overflowY: "auto", color: t.textMuted, maxWidth: "700px", margin: "8px auto 0" },
  };

  const isInstalled = status?.built && status?.svcInstalled;
  const isRunning   = status?.running;

  return (
    <div style={s.wrap}>
      <div style={s.row}>
        <span style={{ ...s.label, opacity: 0.5 }}>v3 Sync-Server</span>

        {status === null && (
          <span style={{ ...s.text, color: t.textVeryMuted }}>…</span>
        )}

        {status !== null && !isInstalled && !busy && (
          <>
            <span style={{ ...s.text, color: t.textVeryMuted }}>nicht installiert</span>
            <button style={s.btnGold} onClick={install}>Installieren</button>
          </>
        )}

        {status !== null && isInstalled && !busy && (
          <>
            <span style={{ ...s.text, color: isRunning ? (t.dark ? "rgba(150,255,180,0.6)" : "#2a7a2a") : "rgba(255,120,120,0.7)" }}>
              {isRunning ? "✓ läuft" : "✕ gestoppt"}
            </span>
            {status.version && (
              <span style={{ ...s.text, color: t.textFaint }}>v{status.version}</span>
            )}
            <button style={s.btnGold} onClick={install}>Update & Neustart</button>
            <button style={s.btn} onClick={showLogs ? () => setShowLogs(false) : fetchLogs}>
              {showLogs ? "Logs ausblenden" : "Logs"}
            </button>
          </>
        )}

        {busy && (
          <span style={{ ...s.text, color: t.textVeryMuted }}>⟳ Installiere…</span>
        )}

        {done && !busy && (
          <span style={{ ...s.text, color: t.dark ? "rgba(150,255,180,0.6)" : "#2a7a2a" }}>✓ Fertig</span>
        )}

        {error && (
          <>
            <span style={{ ...s.text, color: "rgba(255,120,120,0.7)" }}>✕ {error}</span>
            <button style={s.btn} onClick={() => { setError(""); fetchStatus(); }}>Zurück</button>
          </>
        )}
      </div>

      {showLogs && logs && (
        <div style={s.logsBox}>{logs}</div>
      )}
    </div>
  );
}
