import { useState } from "react";

export function V3UpgradePanel({ t, apiKey }) {
  const [status, setStatus] = useState("idle"); // idle | upgrading | restarting | done | error
  const [error, setError]   = useState("");

  const textStyle = {
    fontFamily: t.fontBody, fontSize: "10px",
    letterSpacing: "2px", textTransform: "uppercase",
  };
  const btnStyle = {
    background: "transparent",
    border: "1px solid rgba(120,200,255,0.35)",
    color: "rgba(120,200,255,0.75)",
    padding: "4px 14px", borderRadius: t.filterRadius,
    cursor: "pointer", fontFamily: t.fontBody,
    fontSize: "10px", letterSpacing: "2px",
    textTransform: "uppercase", transition: "all 0.2s",
  };

  const upgrade = () => {
    if (!confirm("Jetzt auf Nagellacke v3 upgraden?\n\nDie App wird neu gestartet. Deine Daten bleiben erhalten.")) return;
    setStatus("upgrading");
    setError("");
    fetch("/api/v3/install", { method: "POST", headers: { "X-Api-Key": apiKey || "" } })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setStatus("error"); return; }
        setStatus("restarting");
        // Poll until v3 is up (it responds on the same port after restart)
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          fetch("/api/version")
            .then(r => r.json())
            .then(v => {
              // v3 returns version string starting with "3."
              if (String(v.version).startsWith("3.") || attempts > 20) {
                clearInterval(poll);
                setStatus("done");
                setTimeout(() => window.location.reload(), 1500);
              }
            })
            .catch(() => { if (attempts > 25) { clearInterval(poll); window.location.reload(); } });
        }, 2000);
      })
      .catch(e => { setError(e.message); setStatus("error"); });
  };

  return (
    <div style={{ textAlign: "center", padding: "0 0 36px" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
        <span style={{ ...textStyle, color: t.textFaint, opacity: 0.5 }}>v2 → v3</span>

        {status === "idle" && (
          <button
            style={btnStyle}
            onMouseEnter={e => { e.currentTarget.style.color = "rgba(120,200,255,1)"; e.currentTarget.style.borderColor = "rgba(120,200,255,0.65)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(120,200,255,0.75)"; e.currentTarget.style.borderColor = "rgba(120,200,255,0.35)"; }}
            onClick={upgrade}
          >
            Upgrade auf v3 (mit Sync)
          </button>
        )}

        {status === "upgrading"  && <span style={{ ...textStyle, color: t.textVeryMuted }}>⟳ Baue v3…</span>}
        {status === "restarting" && <span style={{ ...textStyle, color: t.textVeryMuted }}>⟳ Starte neu…</span>}
        {status === "done"       && <span style={{ ...textStyle, color: "rgba(150,255,180,0.7)" }}>✓ v3 aktiv — lade neu…</span>}
        {status === "error"      && (
          <>
            <span style={{ ...textStyle, color: "rgba(255,120,120,0.7)" }}>✕ {error}</span>
            <button style={{ ...btnStyle, borderColor: t.filterBorder, color: t.textVeryMuted }} onClick={() => setStatus("idle")}>Zurück</button>
          </>
        )}
      </div>
    </div>
  );
}
