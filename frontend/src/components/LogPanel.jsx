import { useState, useCallback, useEffect, useRef } from "react";

export function LogPanel({ t, apiKey }) {
  const [open, setOpen]       = useState(false);
  const [logs, setLogs]       = useState("");
  const [loading, setLoading] = useState(false);
  const [lines, setLines]     = useState(100);
  const [live, setLive]       = useState(false);
  const [hasError, setHasError] = useState(false);
  const logRef   = useRef(null);
  const timerRef = useRef(null);

  const fetchLogs = useCallback((n) => {
    const count = n ?? lines;
    setLoading(true);
    fetch(`/api/logs?lines=${count}`, { headers: { "X-Api-Key": apiKey || "" } })
      .then(r => {
        if (r.status === 401) { setLogs("API-Schlüssel fehlt — bitte in den Einstellungen (⚙) eintragen."); setHasError(true); setLoading(false); return null; }
        return r.json();
      })
      .then(d => {
        if (!d) return;
        setLogs(d.logs || "");
        setHasError(!!d.error);
        setLoading(false);
        setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 30);
      })
      .catch(() => { setHasError(true); setLoading(false); });
  }, [lines, apiKey]);

  useEffect(() => { if (open) fetchLogs(); }, [open]);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (live && open) timerRef.current = setInterval(() => fetchLogs(), 3000);
    return () => clearInterval(timerRef.current);
  }, [live, open, fetchLogs]);

  const handleLines = (n) => { setLines(n); fetchLogs(n); };

  const btnBase = {
    background: "transparent", border: `1px solid ${t.filterBorder}`,
    color: t.textVeryMuted, padding: "3px 12px", borderRadius: t.filterRadius,
    cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px",
    letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s",
  };
  const btnActive = { ...btnBase, background: t.filterBgActive, color: t.filterColorActive, borderColor: t.filterBorderActive };

  if (!open) return (
    <div style={{ textAlign: "center", paddingBottom: "12px" }}>
      <button style={btnBase}
        onMouseEnter={e => Object.assign(e.currentTarget.style, { color: t.textMuted, borderColor: t.filterBorderActive })}
        onMouseLeave={e => Object.assign(e.currentTarget.style, { color: t.textVeryMuted, borderColor: t.filterBorder })}
        onClick={() => setOpen(true)}>
        ≡ System Logs
      </button>
    </div>
  );

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto 40px", padding: "0 18px" }}>
      <div style={{ background: t.dark ? "rgba(0,0,0,0.55)" : t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: `1px solid ${t.textFaint}`, flexWrap: "wrap" }}>
          {/* UX-7: CSS-animated spinner instead of static ⟳ glyph */}
          <span style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "3px", color: t.textVeryMuted, textTransform: "uppercase", flexShrink: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            ≡ System Logs
            {loading && (
              <>
                <style>{`@keyframes logSpin{to{transform:rotate(360deg);}}`}</style>
                <span aria-label="Lade…" style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(180,180,180,0.2)", borderTopColor: t.textVeryMuted, borderRadius: "50%", animation: "logSpin 0.7s linear infinite" }} />
              </>
            )}
          </span>
          <div style={{ display: "flex", gap: "6px", marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
            {[50, 100, 200].map(n => (
              <button key={n} style={lines === n ? btnActive : btnBase} onClick={() => handleLines(n)}>{n}</button>
            ))}
            <button style={live ? { ...btnActive, borderColor: "rgba(100,255,150,0.4)", color: "rgba(100,255,150,0.8)" } : btnBase}
              onClick={() => setLive(v => !v)}>
              {live ? "● Live" : "○ Live"}
            </button>
            <button style={btnBase} onClick={() => fetchLogs()}
              onMouseEnter={e => Object.assign(e.currentTarget.style, { color: t.textMuted, borderColor: t.filterBorderActive })}
              onMouseLeave={e => Object.assign(e.currentTarget.style, { color: t.textVeryMuted, borderColor: t.filterBorder })}>
              ↺ Refresh
            </button>
            <button style={{ ...btnBase, borderColor: "rgba(255,80,80,0.25)", color: "rgba(255,100,100,0.5)" }}
              onClick={() => { setOpen(false); setLive(false); }}
              onMouseEnter={e => Object.assign(e.currentTarget.style, { color: "rgba(255,120,120,0.9)", borderColor: "rgba(255,80,80,0.55)" })}
              onMouseLeave={e => Object.assign(e.currentTarget.style, { color: "rgba(255,100,100,0.5)", borderColor: "rgba(255,80,80,0.25)" })}>
              ✕ Schließen
            </button>
          </div>
        </div>
        <pre ref={logRef} style={{
          margin: 0, padding: "14px 18px", maxHeight: "420px", overflowY: "auto",
          fontFamily: "'Courier New', 'Consolas', monospace", fontSize: "11px",
          lineHeight: "1.6", color: hasError ? "rgba(255,140,140,0.8)" : t.dark ? "rgba(180,220,180,0.85)" : "rgba(20,80,20,0.9)",
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {logs || (loading ? "Lade…" : "Keine Logs verfügbar")}
        </pre>
      </div>
    </div>
  );
}
