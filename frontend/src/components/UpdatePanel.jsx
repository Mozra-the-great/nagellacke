import { useState, useEffect, useRef } from "react";

const UPDATE_CACHE_TTL = 10 * 60 * 1000;

export function UpdatePanel({ t, apiKey }) {
  const [version, setVersion]             = useState(null);
  const [status, setStatus]               = useState("idle");
  const [latestVersion, setLatestVersion] = useState(null);
  const [errorMsg, setErrorMsg]           = useState("");
  const [v3Status, setV3Status]           = useState("idle"); // idle | upgrading | restarting | done | error
  const [v3Error, setV3Error]             = useState("");
  const pollRef                           = useRef(null);

  useEffect(() => {
    fetch("/api/version").then(r => r.json()).then(d => setVersion(d.version)).catch(() => {});
    return () => clearInterval(pollRef.current);
  }, []);

  const check = () => {
    setStatus("checking"); setErrorMsg("");
    const cached = JSON.parse(localStorage.getItem("nagellacke_update_cache") || "null");
    if (cached && Date.now() - cached.ts < UPDATE_CACHE_TTL) {
      if (cached.updateAvailable) { setLatestVersion(cached.latestVersion); setStatus("available"); }
      else { setStatus("uptodate"); setTimeout(() => setStatus("idle"), 3500); }
      return;
    }
    fetch("/api/update/check", { headers: { "X-Api-Key": apiKey || "" } })
      .then(r => {
        if (r.status === 401) { setErrorMsg("API-Schlüssel fehlt — bitte in den Einstellungen (⚙) eintragen."); setStatus("error"); return null; }
        return r.json();
      })
      .then(d => {
        if (!d) return;
        if (d.error) { setErrorMsg(d.error); setStatus("error"); return; }
        localStorage.setItem("nagellacke_update_cache", JSON.stringify({ ts: Date.now(), updateAvailable: !!d.updateAvailable, latestVersion: d.latestVersion || null }));
        if (d.updateAvailable) { setLatestVersion(d.latestVersion); setStatus("available"); }
        else { setStatus("uptodate"); setTimeout(() => setStatus("idle"), 3500); }
      })
      .catch(e => { setErrorMsg(e.message); setStatus("error"); });
  };

  const applyUpdate = () => {
    setStatus("updating");
    localStorage.removeItem("nagellacke_update_cache");
    fetch("/api/update/apply", { method: "POST", headers: { "X-Api-Key": apiKey || "" } })
      .then(r => {
        if (r.status === 401) { setErrorMsg("API-Schlüssel fehlt — bitte in den Einstellungen (⚙) eintragen."); setStatus("error"); return null; }
        return r.json();
      })
      .then(d => {
        if (!d) return;
        if (d.error) { setErrorMsg(d.error); setStatus("error"); return; }
        setStatus("restarting");
        const hardReload = async () => {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          } catch { /* ignore if caches API unavailable */ }
          window.location.reload();
        };
        let downCount = 0;
        pollRef.current = setInterval(() => {
          fetch("/api/version").then(r => r.json()).then(d => {
            if (!d.version) return;
            if (d.version !== version || downCount >= 2) {
              clearInterval(pollRef.current);
              void hardReload();
            }
            downCount = 0;
          }).catch(() => { downCount++; });
        }, 2000);
        setTimeout(() => { clearInterval(pollRef.current); void hardReload(); }, 180000);
      }).catch(e => { setErrorMsg(e.message); setStatus("error"); });
  };

  const upgradeToV3 = () => {
    if (!window.confirm("Jetzt auf Nagellacke v3 upgraden?\n\nDie App wird neu gestartet. Deine Daten bleiben erhalten.")) return;
    setV3Status("upgrading"); setV3Error("");
    fetch("/api/v3/install", { method: "POST", headers: { "X-Api-Key": apiKey || "" } })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setV3Error(d.error); setV3Status("error"); return; }
        setV3Status("restarting");
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          fetch("/api/v3/status", { headers: { "X-Api-Key": apiKey || "" } })
            .then(r => r.json())
            .then(s => {
              if (s.installState === "error") {
                clearInterval(poll);
                setV3Error(s.installError || "Build fehlgeschlagen");
                setV3Status("error");
                return;
              }
              if (s.running || attempts > 30) {
                clearInterval(poll); setV3Status("done");
                setTimeout(() => window.location.reload(), 1500);
              }
            })
            .catch(() => { if (attempts > 35) { clearInterval(poll); window.location.reload(); } });
        }, 2000);
      })
      .catch(e => { setV3Error(e.message); setV3Status("error"); });
  };

  const s = { fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase" };
  const btn  = { background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.textVeryMuted, padding: "4px 14px", borderRadius: t.filterRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" };
  const gold = { ...btn, borderColor: "rgba(255,210,60,0.45)", color: "rgba(255,210,60,0.75)" };
  const blue = { ...btn, borderColor: "rgba(120,200,255,0.45)", color: "rgba(120,200,255,0.8)" };

  return (
    <div style={{ textAlign: "center", padding: "0 0 36px" }}>
      {/* v2 update row */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center", marginBottom: "14px" }}>
        {version && <span style={{ ...s, color: t.textFaint }}>v{version}</span>}
        {status === "idle"       && <button style={btn} onMouseEnter={e => { e.currentTarget.style.color = t.textMuted; e.currentTarget.style.borderColor = t.filterBorderActive; }} onMouseLeave={e => { e.currentTarget.style.color = t.textVeryMuted; e.currentTarget.style.borderColor = t.filterBorder; }} onClick={check}>Updates prüfen</button>}
        {status === "checking"   && <span style={{ ...s, color: t.textVeryMuted }}>Prüfe…</span>}
        {status === "uptodate"   && <span style={{ ...s, color: t.dark ? "rgba(150,255,180,0.55)" : "#2a7a2a" }}>✓ Aktuell</span>}
        {status === "available"  && <><span style={{ ...s, color: "rgba(255,210,60,0.75)" }}>↑ v{latestVersion} verfügbar</span><button style={gold} onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,210,60,1)"; e.currentTarget.style.background = "rgba(255,210,60,0.07)"; }} onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,210,60,0.75)"; e.currentTarget.style.background = "transparent"; }} onClick={applyUpdate}>Jetzt updaten</button></>}
        {status === "updating"   && <span style={{ ...s, color: t.textVeryMuted }}>⟳ Installiere…</span>}
        {status === "restarting" && <span style={{ ...s, color: t.dark ? "rgba(150,255,180,0.6)" : "#2a7a2a" }}>✓ Installiert · warte auf Neustart…</span>}
        {status === "error"      && <><span style={{ ...s, color: "rgba(255,120,120,0.7)" }}>✕ {errorMsg}</span><button style={btn} onClick={() => setStatus("idle")}>Zurück</button></>}
      </div>

      {/* v3 upgrade row — nur wenn noch nicht auf v3 */}
      {!String(version || "").startsWith("3.") && <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
        <span style={{ ...s, color: t.textFaint, opacity: 0.45 }}>v2 → v3</span>
        {v3Status === "idle"       && <button style={blue} onMouseEnter={e => { e.currentTarget.style.color = "rgba(120,200,255,1)"; e.currentTarget.style.borderColor = "rgba(120,200,255,0.75)"; }} onMouseLeave={e => { e.currentTarget.style.color = "rgba(120,200,255,0.8)"; e.currentTarget.style.borderColor = "rgba(120,200,255,0.45)"; }} onClick={upgradeToV3}>Upgrade auf v3 (mit Sync)</button>}
        {v3Status === "upgrading"  && <span style={{ ...s, color: t.textVeryMuted }}>⟳ Baue v3…</span>}
        {v3Status === "restarting" && <span style={{ ...s, color: t.textVeryMuted }}>⟳ Starte neu…</span>}
        {v3Status === "done"       && <span style={{ ...s, color: "rgba(150,255,180,0.7)" }}>✓ v3 aktiv — lade neu…</span>}
        {v3Status === "error"      && <><span style={{ ...s, color: "rgba(255,120,120,0.7)" }}>✕ {v3Error}</span><button style={btn} onClick={() => setV3Status("idle")}>Zurück</button></>}
      </div>}
    </div>
  );
}
