import { useState, useCallback } from "react";

const KEY_TOKEN = "nagellacke_sync_token";
const KEY_USER  = "nagellacke_sync_user";
const KEY_LAST  = "nagellacke_sync_last";

export function SyncPanel({ t, polishes, customCats, manicures, stickers, onSyncComplete }) {
  const [token,    setToken]    = useState(() => localStorage.getItem(KEY_TOKEN) || "");
  const [username, setUsername] = useState(() => localStorage.getItem(KEY_USER)  || "");
  const [lastSync, setLastSync] = useState(() => localStorage.getItem(KEY_LAST)  || "");

  const [view,     setView]     = useState("main"); // "main" | "login" | "register"
  const [userIn,   setUserIn]   = useState("");
  const [passIn,   setPassIn]   = useState("");
  const [status,   setStatus]   = useState("idle"); // "idle"|"loading"|"syncing"|"success"|"error"
  const [errMsg,   setErrMsg]   = useState("");

  const s    = { fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase" };
  const btn  = { background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.textVeryMuted, padding: "4px 14px", borderRadius: t.filterRadius, cursor: "pointer", fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", transition: "all 0.2s" };
  const blue = { ...btn, borderColor: "rgba(120,200,255,0.45)", color: "rgba(120,200,255,0.8)" };

  const openView = (v) => { setView(v); setStatus("idle"); setErrMsg(""); };
  const reset    = ()  => { openView("main"); setUserIn(""); setPassIn(""); };

  const doAuth = useCallback(() => {
    if (!userIn.trim() || passIn.length < 8) {
      setErrMsg("Benutzername und Passwort (min. 8 Zeichen) erforderlich");
      setStatus("error");
      return;
    }
    setStatus("loading"); setErrMsg("");
    fetch(`/api/auth/${view}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: userIn.trim(), password: passIn }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setErrMsg(d.error); setStatus("error"); return; }
        localStorage.setItem(KEY_TOKEN, d.token);
        localStorage.setItem(KEY_USER,  userIn.trim());
        setToken(d.token); setUsername(userIn.trim());
        reset(); setStatus("idle");
      })
      .catch(e => { setErrMsg(e.message); setStatus("error"); });
  }, [view, userIn, passIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSync = useCallback(() => {
    setStatus("syncing"); setErrMsg("");
    fetch("/api/sync", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { polishes, customCats, manicures, stickers } }),
    })
      .then(r => {
        if (r.status === 401) {
          localStorage.removeItem(KEY_TOKEN);
          setToken(""); setErrMsg("Token abgelaufen — bitte neu anmelden"); setStatus("error");
          return null;
        }
        return r.json();
      })
      .then(d => {
        if (!d) return;
        if (d.error) { setErrMsg(d.error); setStatus("error"); return; }
        const now = new Date().toISOString();
        localStorage.setItem(KEY_LAST, now);
        setLastSync(now); setStatus("success");
        setTimeout(() => setStatus("idle"), 3000);
        if (d.data) onSyncComplete(d.data);
      })
      .catch(e => { setErrMsg(e.message); setStatus("error"); });
  }, [token, polishes, customCats, manicures, stickers, onSyncComplete]);

  const logout = () => {
    localStorage.removeItem(KEY_TOKEN); localStorage.removeItem(KEY_USER);
    setToken(""); setUsername(""); setStatus("idle"); setErrMsg("");
  };

  const fmt = (iso) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return null; }
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto 24px", padding: "0 18px" }}>
      <div style={{ background: t.dark ? "rgba(0,0,0,0.35)" : t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, padding: "12px 18px" }}>

        {/* ── Hauptzeile ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ ...s, color: t.textVeryMuted, flexShrink: 0 }}>⟳ Sync</span>

          {token && <span style={{ ...s, color: t.textFaint }}>· {username}</span>}

          {/* Nicht eingeloggt */}
          {!token && view === "main" && (
            <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
              <button style={blue} onClick={() => openView("login")}>Anmelden</button>
              <button style={btn}  onClick={() => openView("register")}>Konto erstellen</button>
            </div>
          )}

          {/* Eingeloggt */}
          {token && view === "main" && (
            <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              {lastSync && <span style={{ ...s, color: t.textFaint, opacity: 0.55 }}>{fmt(lastSync)}</span>}
              {status === "idle"    && <button style={blue} onClick={doSync}>Jetzt syncen</button>}
              {status === "syncing" && <span style={{ ...s, color: t.textVeryMuted }}>⟳ Synchronisiere…</span>}
              {status === "success" && <span style={{ ...s, color: t.dark ? "rgba(150,255,180,0.7)" : "#2a7a2a" }}>✓ Synchronisiert</span>}
              {status === "error"   && (
                <>
                  <span style={{ ...s, color: "rgba(255,120,120,0.7)" }}>✕ {errMsg}</span>
                  <button style={btn} onClick={() => { setStatus("idle"); setErrMsg(""); }}>Zurück</button>
                </>
              )}
              <button style={{ ...btn, opacity: 0.45 }} onClick={logout}>Abmelden</button>
            </div>
          )}
        </div>

        {/* ── Login / Register Formular ── */}
        {(view === "login" || view === "register") && (
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap", marginTop: "10px" }}>
            <input className="form-input" placeholder="Benutzername"
              value={userIn} onChange={e => setUserIn(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doAuth()}
              style={{ flex: 1, minWidth: "130px", padding: "7px 10px", fontSize: "12px" }} />
            <input type="password" className="form-input" placeholder="Passwort (min. 8 Zeichen)"
              value={passIn} onChange={e => setPassIn(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doAuth()}
              style={{ flex: 1, minWidth: "150px", padding: "7px 10px", fontSize: "12px" }} />
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              {status === "loading"
                ? <span style={{ ...s, color: t.textVeryMuted }}>…</span>
                : <button style={blue} onClick={doAuth}>{view === "login" ? "Anmelden" : "Registrieren"}</button>
              }
              <button style={btn} onClick={reset}>✕</button>
            </div>
            {status === "error" && (
              <span style={{ ...s, color: "rgba(255,120,120,0.7)", width: "100%", marginTop: "2px" }}>✕ {errMsg}</span>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
