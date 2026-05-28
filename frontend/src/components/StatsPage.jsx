import { useState, useMemo } from "react";
import { FINISH_OPTIONS } from "../constants.js";
import { hexToHue } from "../utils.js";

function Bar({ t, value, max, color }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div style={{ flex: 1, height: "6px", background: t.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textVeryMuted, minWidth: "28px", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function StatCard({ t, children, style }) {
  return (
    <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: t.cardRadius, padding: "22px 24px", ...style }}>
      {children}
    </div>
  );
}

function CardLabel({ t, children }) {
  return <div style={{ fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", color: t.textVeryMuted, marginBottom: "14px" }}>{children}</div>;
}

export function StatsPage({ t, polishes, customCats, onSelectPolish }) {
  const [clickedColor, setClickedColor] = useState(null);
  const total        = polishes.length;
  const totalBottles = polishes.reduce((a, p) => a + (p.count || 1), 0);
  const available    = polishes.filter(p => (p.status || "ok") === "ok").length;
  const wish         = polishes.filter(p => p.status === "wish").length;
  const empty        = polishes.filter(p => p.status === "empty").length;
  const gone         = polishes.filter(p => p.status === "gone").length;

  const finishCounts = useMemo(() => {
    const map = {};
    polishes.forEach(p => { const f = p.finish || "Classic"; map[f] = (map[f] || 0) + 1; });
    return FINISH_OPTIONS.filter(f => map[f.value]).map(f => ({ ...f, count: map[f.value] || 0 }));
  }, [polishes]);

  const byBrand = useMemo(() => {
    const map = {};
    polishes.forEach(p => { const b = p.brand || "—"; map[b] = (map[b] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [polishes]);

  const byCat = useMemo(() => {
    return customCats.map(c => ({
      label: c.label,
      count: polishes.filter(p => (p.categories || []).includes(c.id)).length,
    })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
  }, [polishes, customCats]);

  const colorPalette = useMemo(() => {
    const unique = [...new Set(polishes.map(p => p.color))];
    return unique.sort((a, b) => hexToHue(a) - hexToHue(b));
  }, [polishes]);

  const bigNum = { fontFamily: t.fontDisplay, fontSize: "42px", fontWeight: 300, lineHeight: 1, color: t.text };
  const bigLabel = { fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: t.textVeryMuted, marginTop: "6px" };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 18px 60px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "14px", marginBottom: "20px" }}>
        {[
          { value: total,        label: "Lacke gesamt",   color: t.text },
          { value: totalBottles, label: "Flaschen",       color: t.dark ? "rgba(200,230,255,0.9)"  : "#1a4080" },
          { value: available,    label: "Verfügbar",      color: t.dark ? "rgba(150,255,180,0.85)" : "#1a6b2a" },
          { value: wish,         label: "Wunschliste",    color: t.dark ? "rgba(180,160,255,0.85)" : "#5040a0" },
          { value: empty + gone, label: "Leer / Weg",     color: t.dark ? "rgba(255,180,80,0.85)"  : "#804000" },
        ].map(({ value, label, color }) => (
          <StatCard t={t} key={label}>
            <div style={{ ...bigNum, color }}>{value}</div>
            <div style={bigLabel}>{label}</div>
          </StatCard>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "20px" }}>
        <StatCard t={t}>
          <CardLabel t={t}>Marken</CardLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {byBrand.map(([brand, count]) => (
              <div key={brand}>
                <div style={{ marginBottom: "4px" }}>
                  <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted, letterSpacing: "1px" }}>{brand}</span>
                </div>
                <Bar t={t} value={count} max={total} color="rgba(180,180,255,0.55)" />
              </div>
            ))}
            {byBrand.length === 0 && <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.textVeryMuted }}>Keine Marken eingetragen</span>}
          </div>
        </StatCard>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <StatCard t={t}>
            <CardLabel t={t}>Finish</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {finishCounts.map(({ icon, label, count }) => (
                <div key={label}>
                  <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted, marginBottom: "3px" }}>{icon} {label}</div>
                  <Bar t={t} value={count} max={total} color="rgba(200,200,255,0.55)" />
                </div>
              ))}
            </div>
          </StatCard>

          <StatCard t={t}>
            <CardLabel t={t}>Status</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { label: "✓ Vorhanden",      value: available, color: "rgba(150,255,180,0.55)" },
                { label: "☆ Wunschliste",    value: wish,      color: "rgba(180,160,255,0.55)" },
                { label: "○ Leer",           value: empty,     color: "rgba(255,200,80,0.55)"  },
                { label: "✕ Nicht mehr da",  value: gone,      color: "rgba(255,100,100,0.55)" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted, marginBottom: "3px" }}>{label}</div>
                  <Bar t={t} value={value} max={total} color={color} />
                </div>
              ))}
            </div>
          </StatCard>
        </div>
      </div>

      {byCat.length > 0 && (
        <StatCard t={t} style={{ marginBottom: "20px" }}>
          <CardLabel t={t}>Eigene Kategorien</CardLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {byCat.map(({ label, count }) => (
              <div key={label}>
                <div style={{ fontFamily: t.fontBody, fontSize: "11px", color: t.textMuted, marginBottom: "3px" }}>◆ {label}</div>
                <Bar t={t} value={count} max={total} color="rgba(220,160,255,0.55)" />
              </div>
            ))}
          </div>
        </StatCard>
      )}

      <StatCard t={t}>
        <CardLabel t={t}>Farb-Palette · {colorPalette.length} Farben</CardLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {colorPalette.map(c => (
            <div key={c} title={c}
              style={{ width: "28px", height: "28px", borderRadius: "50%", background: c,
                       boxShadow: `0 0 8px ${c}66`,
                       border: `1.5px solid ${clickedColor === c ? t.cardBorderActive : (t.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)")}`,
                       flexShrink: 0, transition: "transform 0.2s, border-color 0.15s",
                       cursor: "pointer",
                       transform: clickedColor === c ? "scale(1.35)" : "scale(1)" }}
              onClick={() => setClickedColor(clickedColor === c ? null : c)}
              onMouseEnter={e => { if (clickedColor !== c) e.currentTarget.style.transform = "scale(1.3)"; }}
              onMouseLeave={e => { if (clickedColor !== c) e.currentTarget.style.transform = "scale(1)"; }} />
          ))}
        </div>
        {clickedColor && (() => {
          const matches = polishes.map((p, i) => ({ p, i })).filter(({ p }) => p.color === clickedColor);
          return (
            <div style={{ marginTop: "14px", borderTop: `1px solid ${t.textFaint}`, paddingTop: "12px" }}>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: clickedColor, boxShadow: `0 0 14px ${clickedColor}88`, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: t.fontBody, fontSize: "10px", letterSpacing: "2px", color: t.textVeryMuted, textTransform: "uppercase", marginBottom: "8px" }}>
                    {clickedColor.toUpperCase()} · {matches.length} Lack{matches.length !== 1 ? "e" : ""}
                  </div>
                  {matches.map(({ p, i }) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
                      <span style={{ fontFamily: t.fontDisplay, fontSize: "13px", color: t.text }}>{p.name}</span>
                      {p.brand && <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted }}>{p.brand}</span>}
                      {p.num && <span style={{ fontFamily: t.fontBody, fontSize: "10px", color: t.textVeryMuted }}>№ {p.num}</span>}
                      {onSelectPolish && (
                        <button onClick={() => onSelectPolish(i)}
                          style={{ background: "transparent", border: `1px solid ${t.filterBorder}`, color: t.filterColor,
                                   borderRadius: t.filterRadius, padding: "2px 10px", cursor: "pointer",
                                   fontFamily: t.fontBody, fontSize: "9px", letterSpacing: "1.5px",
                                   textTransform: "uppercase", marginLeft: "auto", whiteSpace: "nowrap" }}>
                          → Kollektion
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => setClickedColor(null)}
                  style={{ background: "transparent", border: "none", color: t.textVeryMuted, cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "2px", flexShrink: 0 }}>×</button>
              </div>
            </div>
          );
        })()}
      </StatCard>

      {(() => {
        const topRated = [...polishes].filter(p => (p.rating || 0) > 0).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 5);
        if (!topRated.length) return null;
        return (
          <StatCard t={t} style={{ marginTop: "20px" }}>
            <CardLabel t={t}>Top Bewertet</CardLabel>
            {topRated.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", borderBottom: i < topRated.length - 1 ? `1px solid ${t.textFaint}` : "none" }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
                <div style={{ flex: 1, fontFamily: t.fontBody, fontSize: "12px", color: t.textMuted }}>{p.name}{p.brand ? ` · ${p.brand}` : ""}</div>
                <span style={{ fontFamily: t.fontBody, fontSize: "12px", color: t.accentText, letterSpacing: "1px" }}>{"★".repeat(p.rating)}</span>
              </div>
            ))}
          </StatCard>
        );
      })()}
    </div>
  );
}
