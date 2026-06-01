import { useState, useEffect, useRef } from "react";
import { V3UpgradePanel } from "./V3UpgradePanel.jsx";

const UPDATE_CACHE_TTL = 10 * 60 * 1000;

export function UpdatePanel({ t, apiKey }) {
  const [version, setVersion]             = useState(null);
  const [status, setStatus]               = useState("idle");
  const [latestVersion, setLatestVersion] = useState(null);
  const [errorMsg, setErrorMsg]           = useState("");
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
        // Track consecutive failures to detect server going down then coming back
        let downCount = 0;
        pollRef.current = setInterval(() => {
          fetch("/api/version").then(r => r.json()).then(d => {
            if (!d.version) return;
            // Reload if version changed OR if server was down and is back up
            if (d.version !== version || downCount >= 2) {
              clearInterval(pollRef.current);
              window.location.reload();
            }
            downCount = 0;
          }).catch(() => { downCount++; });
        }, 2000);
        setTimeout(() => { clearInterval(pollRef.current); window.location.reload(); }, 45000);
      }).catch(e => { setErrorMsg(e.message); setStatus("error"); });
  };

  const btnStyle = { background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.textVeryMuted, padding: "4px 14px", borderRadius: t.filterRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" };
  const updateBtnStyle = { ...btnStyle, borderColor: "rgba(255,210,60,0.45)", color: "rgba(255,210,60,0.75)" };
  const textStyle = { fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase" };

  return (
    <>
      <div style={{ textAlign: "center", padding: "0 0 12px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
          {version && <span style={{ ...textStyle, color: t.textFaint }}>v{version}</span>}
          {status === "idle"       && <button style={btnStyle} onMouseEnter={e => { e.currentTarget.style.color = t.textMuted; e.currentTarget.style.borderColor = t.filterBorderActive; }} onMouseLeave={e => { e.currentTarget.style.color = t.textVeryMuted; e.currentTarget.style.borderColor = t.filterBorder; }} onClick={check}>Updates prüfen</button>}
          {status === "checking"   && <span style={{ ...textStyle, color: t.textVeryMuted }}>Prüfe…</span>}
          {status === "uptodate"   && <span style={{ ...textStyle, color: t.dark ? "rgba(150,255,180,0.55)" : "#2a7a2a" }}>✓ Aktuell</span>}
          {status === "available"  && <>
            <span style={{ ...textStyle, color: "rgba(255,210,60,0.75)" }}>↑ v{latestVersion} verfügbar</span>
            <button style={updateBtnStyle} onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,210,60,1)"; e.currentTarget.style.borderColor = "rgba(255,210,60,0.75)"; e.currentTarget.style.background = "rgba(255,210,60,0.07)"; }} onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,210,60,0.75)"; e.currentTarget.style.borderColor = "rgba(255,210,60,0.45)"; e.currentTarget.style.background = "transparent"; }} onClick={applyUpdate}>Jetzt updaten</button>
          </>}
          {status === "updating"   && <span style={{ ...textStyle, color: t.textVeryMuted }}>⟳ Installiere Update…</span>}
          {status === "restarting" && <span style={{ ...textStyle, color: t.dark ? "rgba(150,255,180,0.6)" : "#2a7a2a" }}>✓ Update installiert · warte auf Neustart…</span>}
          {status === "error"      && <>
            <span style={{ ...textStyle, color: "rgba(255,120,120,0.7)" }}>✕ {errorMsg}</span>
            <button style={btnStyle} onClick={() => setStatus("idle")}>Zurück</button>
          </>}
        </div>
      </div>
      <V3UpgradePanel t={t} apiKey={apiKey} />
    </>
  );
}
