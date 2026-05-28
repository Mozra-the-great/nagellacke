import { useMemo } from "react";
import { SHIMMER_FINISHES } from "../constants.js";

export function NailBottle({ color, finish, selected, status, brand, photoUrl }) {
  if (photoUrl) {
    const faded = status === "empty" || status === "gone";
    return (
      <div style={{ width: 64, height: 130, borderRadius: "10px", overflow: "hidden",
                    opacity: faded ? 0.38 : status === "wish" ? 0.62 : 1,
                    boxShadow: selected ? `0 0 14px ${color}bb` : "0 4px 10px rgba(0,0,0,0.55)",
                    transition: "box-shadow 0.3s, opacity 0.3s", flexShrink: 0 }}>
        <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    );
  }
  const uid = useMemo(() => color.replace("#", "") + Math.random().toString(36).slice(2, 7), []);
  const gId = `g${uid}`, sId = `s${uid}`, glId = `gl${uid}`;
  const faded = status === "empty" || status === "gone";
  const isWish = status === "wish";
  const shimmer = SHIMMER_FINISHES.has(finish || "Classic");
  const brandLabel = (brand || "").toUpperCase().slice(0, 9);
  const brandFs = brandLabel.length > 6 ? "3" : "4";
  return (
    <svg width="64" height="130" viewBox="0 0 64 130" fill="none" aria-hidden="true" focusable="false"
      style={{ filter: selected ? `drop-shadow(0 0 14px ${color}bb)` : "drop-shadow(0 4px 10px rgba(0,0,0,0.55))", transition: "filter 0.3s, opacity 0.3s", opacity: faded ? 0.38 : isWish ? 0.62 : 1 }}>
      <defs>
        <linearGradient id={gId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} />
          <stop offset="60%" stopColor={color} stopOpacity="0.85" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id={sId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="white" stopOpacity="0.35" />
          <stop offset="40%" stopColor="white" stopOpacity="0.07" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        {shimmer && (
          <linearGradient id={glId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.55" />
            <stop offset="25%" stopColor={color} />
            <stop offset="50%" stopColor="white" stopOpacity="0.35" />
            <stop offset="75%" stopColor={color} />
            <stop offset="100%" stopColor="white" stopOpacity="0.5" />
          </linearGradient>
        )}
      </defs>
      <rect x="18" y="2" width="28" height="28" rx="5" fill="#1a1a1a" />
      <rect x="20" y="4" width="24" height="24" rx="4" fill="#2a2a2a" />
      <rect x="22" y="5" width="8" height="22" rx="2" fill="white" fillOpacity="0.07" />
      <rect x="26" y="30" width="12" height="12" fill="#1a1a1a" />
      <rect x="27" y="30" width="5" height="12" fill="white" fillOpacity="0.04" />
      <rect x="10" y="42" width="44" height="82" rx="6" fill={shimmer ? `url(#${glId})` : `url(#${gId})`} />
      <rect x="10" y="42" width="44" height="82" rx="6" fill={`url(#${sId})`} />
      {status === "empty" && <rect x="10" y="90" width="44" height="34" rx="0" fill="rgba(0,0,0,0.55)" />}
      {isWish && <text x="32" y="39" textAnchor="middle" fontSize="10" fill="rgba(200,180,255,0.9)">☆</text>}
      <rect x="15" y="48" width="10" height="40" rx="3" fill="white" fillOpacity="0.17" />
      <rect x="16" y="49" width="4" height="20" rx="2" fill="white" fillOpacity="0.24" />
      <rect x="10" y="108" width="44" height="16" rx="6" fill="black" fillOpacity="0.2" />
      <rect x="18" y="75" width="28" height="30" rx="2" fill="white" fillOpacity="0.11" />
      <text x="32" y="87" textAnchor="middle" fontSize={brandFs} fill="white" fillOpacity="0.65" fontFamily="serif" letterSpacing="0.3">{brandLabel}</text>
      <line x1="20" y1="90" x2="44" y2="90" stroke="white" strokeOpacity="0.25" strokeWidth="0.5" />
      <text x="32" y="98" textAnchor="middle" fontSize="3.5" fill="white" fillOpacity="0.45" fontFamily="sans-serif">nail lacquer</text>
    </svg>
  );
}
