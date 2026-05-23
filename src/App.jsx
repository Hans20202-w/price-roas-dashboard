import { useState, useMemo } from "react";

const FACTORY_DEFAULTS = {
  // Front-end
  sellingPrice: 69.99,
  cogs: 37.56,
  txFeeRate: 7.8,
  targetFrontMargin: 0, // breakeven front-end by default
  // Backend rebills
  rebillPrice: 29.99,
  rebillCycles: 3,
  stickRate: 70,
  chargebackRate: 10,
  refundRate: 10,
  cbFee: 25,
  preAlertRate: 3,
  preAlertFee: 20,
  // Google Shopping
  conversionRate: 2.0,
};

const STORAGE_KEY = "roas-calc-defaults-v2";

function loadDefaults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return FACTORY_DEFAULTS;
    return { ...FACTORY_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return FACTORY_DEFAULTS;
  }
}

function calc(inputs) {
  const {
    sellingPrice, cogs, txFeeRate, targetFrontMargin,
    rebillPrice, rebillCycles, stickRate, chargebackRate, refundRate, cbFee, preAlertRate, preAlertFee,
    conversionRate,
  } = inputs;

  const stick = stickRate / 100;
  const cbR = chargebackRate / 100;
  const refR = refundRate / 100;
  const txR = txFeeRate / 100;
  const paR = preAlertRate / 100;
  const cvr = conversionRate / 100;

  // Front-end: gross margin after COGS and processing fees, before ad spend
  const frontEndGross = sellingPrice - cogs - sellingPrice * txR;

  // Backend: cumulative net from rebills (after losses, fees, chargebacks, refunds, pre-alerts)
  let backendNet = 0;
  let active = 1;
  const rebillDetails = [];
  for (let i = 0; i < rebillCycles; i++) {
    active = i === 0 ? stick : active * stick;
    const rev = active * rebillPrice;
    const fees = rev * txR;
    const cbLoss = active * cbR * rebillPrice;
    const cbFees = active * cbR * cbFee;
    const refLoss = active * refR * rebillPrice;
    const alertCost = active * paR * preAlertFee;
    const net = rev - fees - cbLoss - cbFees - refLoss - alertCost;
    backendNet += net;
    rebillDetails.push({ cycle: i + 1, customers: active, rev, net });
  }

  const totalNetPerCustomer = frontEndGross + backendNet;

  // Max CPA scenarios
  const maxCPA_breakevenTotal = totalNetPerCustomer; // overall breakeven (front bleeds OK if backend covers it)
  const maxCPA_breakevenFront = frontEndGross; // front-end at $0, backend = pure profit
  const targetCPA = Math.max(0, frontEndGross - targetFrontMargin); // hit your target front-end margin

  // ROAS = revenue (selling price) / ad spend (CPA)
  const breakevenROAS_total = sellingPrice / maxCPA_breakevenTotal;
  const frontBreakevenROAS = sellingPrice / maxCPA_breakevenFront;
  const targetROAS = targetCPA > 0 ? sellingPrice / targetCPA : Infinity;

  // Max CPC at given conversion rate
  const maxCPC_target = targetCPA * cvr;
  const maxCPC_frontBE = maxCPA_breakevenFront * cvr;
  const maxCPC_totalBE = maxCPA_breakevenTotal * cvr;

  // Profit per customer at target CPA
  const profitAtTargetCPA = targetFrontMargin + backendNet;

  // CPA scenarios table
  const cpaScenarios = [
    { label: "Cheap clicks", cpa: targetCPA * 0.5 },
    { label: "Comfortable", cpa: targetCPA * 0.75 },
    { label: "Target", cpa: targetCPA, highlight: true },
    { label: "Front-end BE", cpa: maxCPA_breakevenFront, alt: true },
    { label: "Total BE (max)", cpa: maxCPA_breakevenTotal, danger: true },
    { label: "Over the line", cpa: maxCPA_breakevenTotal * 1.2, danger: true, over: true },
  ].map((s) => {
    const frontNetAfterAds = frontEndGross - s.cpa;
    const totalProfit = frontNetAfterAds + backendNet;
    return { ...s, frontNetAfterAds, totalProfit };
  });

  return {
    frontEndGross, backendNet, totalNetPerCustomer,
    maxCPA_breakevenTotal, maxCPA_breakevenFront, targetCPA,
    breakevenROAS_total, frontBreakevenROAS, targetROAS,
    maxCPC_target, maxCPC_frontBE, maxCPC_totalBE,
    profitAtTargetCPA,
    cpaScenarios,
    rebillDetails,
  };
}

function Field({ label, value, onChange, prefix, suffix, step = "1", hint }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)" }}>
        {label}
      </label>
      <div className="input-wrap">
        {prefix && <span style={{ paddingLeft: 12, color: "var(--green)", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600 }}>{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          step={step}
          className="number-input"
        />
        {suffix && <span style={{ paddingRight: 12, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{suffix}</span>}
      </div>
      {hint && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function SectionHeader({ accent, children, badge }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 4, height: 14, borderRadius: 2, background: accent }} />
        <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0, color: "var(--text)", letterSpacing: "-0.005em" }}>{children}</h2>
        {badge}
      </div>
    </div>
  );
}

function ResultTile({ label, value, sub, color, glow }) {
  return (
    <div style={{
      background: "var(--bg-elev-2)",
      borderRadius: 14,
      padding: "22px 24px",
      border: `1px solid ${color}33`,
      boxShadow: `0 0 0 1px ${color}10, 0 0 30px ${glow}`,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        color: color,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontSize: 38,
        fontWeight: 700,
        color: color,
        letterSpacing: "-0.03em",
        lineHeight: 1,
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color, hint }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "12px 14px",
    }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color, fontFamily: "'JetBrains Mono', monospace" }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export default function App() {
  const [inputs, setInputs] = useState(loadDefaults);
  const [toast, setToast] = useState(null);
  const r = useMemo(() => calc(inputs), [inputs]);

  const u = (k, v) => setInputs((p) => ({ ...p, [k]: v }));
  const fmt = (n) => (n === Infinity ? "∞" : "$" + n.toFixed(2));
  const fmtX = (n) => (n === Infinity ? "∞" : n.toFixed(2) + "x");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const saveAsDefaults = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
      showToast("✓ Saved as your defaults");
    } catch {
      showToast("⚠ Could not save");
    }
  };
  const resetToSaved = () => { setInputs(loadDefaults()); showToast("↻ Reset to saved defaults"); };
  const resetToFactory = () => {
    setInputs(FACTORY_DEFAULTS);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    showToast("↺ Reset to factory defaults");
  };

  let hasSavedDefaults = false;
  try { hasSavedDefaults = !!localStorage.getItem(STORAGE_KEY); } catch {}

  return (
    <div style={{ minHeight: "100vh", padding: "40px 20px 60px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        {/* Header */}
        <header style={{ marginBottom: 28 }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 10px",
            background: "var(--green-glow)",
            border: "1px solid rgba(34, 197, 94, 0.2)",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 500,
            color: "var(--green)",
            marginBottom: 12,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px var(--green)" }} />
            Google Shopping · breakeven front · profit on backend
          </div>
          <h1 style={{
            fontSize: 32,
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.025em",
            background: "linear-gradient(180deg, #fff 0%, #aaa 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>
            Max CPA & CPC Calculator
          </h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14, margin: "4px 0 0" }}>
            How much can you spend per click and per customer while keeping the front-end at breakeven (or your target margin)? Backend rebills do the heavy lifting.
          </p>
        </header>

        {/* Defaults toolbar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-primary" onClick={saveAsDefaults}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            Save as defaults
          </button>
          {hasSavedDefaults && (
            <button className="btn" onClick={resetToSaved}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
              </svg>
              Reset to saved
            </button>
          )}
          <button className="btn btn-ghost" onClick={resetToFactory}>Reset to factory</button>
          {hasSavedDefaults && (
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace" }}>
              ● Custom defaults loaded
            </span>
          )}
        </div>

        {/* ========== INPUTS ========== */}

        {/* Offer */}
        <div className="card">
          <SectionHeader accent="var(--green)">Your offer</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <Field label="Google Shopping price" value={inputs.sellingPrice} onChange={(v) => u("sellingPrice", v)} prefix="$" step="0.01" hint="What customers pay" />
            <Field label="Product cost (COGS)" value={inputs.cogs} onChange={(v) => u("cogs", v)} prefix="$" step="0.01" />
            <Field label="Transaction fee" value={inputs.txFeeRate} onChange={(v) => u("txFeeRate", v)} suffix="%" step="0.1" />
            <Field
              label="Target front-end margin"
              value={inputs.targetFrontMargin}
              onChange={(v) => u("targetFrontMargin", v)}
              prefix="$"
              step="1"
              hint="0 = pure breakeven · 5 = slight profit"
            />
          </div>
        </div>

        {/* Backend */}
        <div className="card">
          <SectionHeader accent="var(--cyan)">Backend (rebills)</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <Field label="Rebill price" value={inputs.rebillPrice} onChange={(v) => u("rebillPrice", v)} prefix="$" step="0.01" />
            <Field label="Rebill cycles" value={inputs.rebillCycles} onChange={(v) => u("rebillCycles", v)} step="1" />
            <Field label="Stick rate" value={inputs.stickRate} onChange={(v) => u("stickRate", v)} suffix="%" />
            <Field label="Chargeback rate" value={inputs.chargebackRate} onChange={(v) => u("chargebackRate", v)} suffix="%" step="0.5" />
            <Field label="Refund rate" value={inputs.refundRate} onChange={(v) => u("refundRate", v)} suffix="%" step="0.5" />
            <Field label="Chargeback fee" value={inputs.cbFee} onChange={(v) => u("cbFee", v)} prefix="$" step="1" />
            <Field label="Pre-alert rate" value={inputs.preAlertRate} onChange={(v) => u("preAlertRate", v)} suffix="%" step="0.5" />
            <Field label="Pre-alert fee" value={inputs.preAlertFee} onChange={(v) => u("preAlertFee", v)} prefix="$" step="1" />
          </div>
        </div>

        {/* Shopping */}
        <div className="card">
          <SectionHeader accent="var(--amber)">Google Shopping performance</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <Field label="Conversion rate" value={inputs.conversionRate} onChange={(v) => u("conversionRate", v)} suffix="%" step="0.1" hint="Clicks → sales · typical 1–4%" />
          </div>
        </div>

        {/* ========== RESULTS HERO ========== */}

        <div style={{
          position: "relative",
          background: "radial-gradient(ellipse at top left, var(--green-glow), transparent 60%), radial-gradient(ellipse at bottom right, var(--cyan-glow), transparent 60%), var(--bg-elev)",
          borderRadius: 20,
          padding: 32,
          border: "1px solid var(--border)",
          marginBottom: 16,
          overflow: "hidden",
        }}>
          <SectionHeader
            accent="var(--green)"
            badge={
              <span style={{
                fontSize: 10,
                color: "var(--text-faint)",
                background: "var(--bg-elev-2)",
                padding: "3px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                fontFamily: "'JetBrains Mono', monospace",
                marginLeft: 8,
              }}>
                target: ${inputs.targetFrontMargin.toFixed(0)} front-end
              </span>
            }
          >
            Your ad-spend ceiling
          </SectionHeader>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <ResultTile
              label="Max CPA per customer"
              value={fmt(r.targetCPA)}
              sub={`Spend up to this and still net $${r.profitAtTargetCPA.toFixed(2)}/customer`}
              color="var(--green)"
              glow="var(--green-glow)"
            />
            <ResultTile
              label="Max CPC"
              value={fmt(r.maxCPC_target)}
              sub={`At ${inputs.conversionRate.toFixed(1)}% conversion rate`}
              color="var(--cyan)"
              glow="var(--cyan-glow)"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, fontSize: 13 }}>
            <MiniStat
              label="Front-end gross"
              value={fmt(r.frontEndGross)}
              color={r.frontEndGross >= 0 ? "var(--green)" : "var(--red)"}
              hint="before ad spend"
            />
            <MiniStat
              label="Backend net"
              value={fmt(r.backendNet)}
              color="var(--cyan)"
              hint={`${inputs.rebillCycles} rebill cycles`}
            />
            <MiniStat
              label="Total / customer"
              value={fmt(r.totalNetPerCustomer)}
              color="var(--text)"
              hint="front + back, no ads"
            />
            <MiniStat
              label="Target ROAS"
              value={fmtX(r.targetROAS)}
              color="var(--amber)"
              hint="selling price ÷ max CPA"
            />
          </div>
        </div>

        {/* ========== CPA SCENARIOS TABLE ========== */}

        <div className="card">
          <SectionHeader accent="var(--violet)">CPA scenarios — what happens if you pay…</SectionHeader>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["", "CPA", "Front-end after ads", "Total profit / cust", "ROAS"].map((h, i) => (
                  <th key={i} style={{
                    textAlign: i === 0 ? "left" : "right",
                    padding: "8px 8px",
                    color: "var(--text-faint)",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    borderBottom: "1px solid var(--border)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.cpaScenarios.map((s, i) => {
                const roas = s.cpa > 0 ? inputs.sellingPrice / s.cpa : Infinity;
                return (
                  <tr key={i} style={{
                    background: s.highlight ? "rgba(34, 197, 94, 0.06)" : s.alt ? "rgba(245, 158, 11, 0.04)" : s.danger ? "rgba(239, 68, 68, 0.04)" : "transparent",
                  }}>
                    <td style={{
                      padding: "12px 8px",
                      borderBottom: i < r.cpaScenarios.length - 1 ? "1px solid var(--border)" : "none",
                      color: s.highlight ? "var(--green)" : s.alt ? "var(--amber)" : s.danger ? "var(--red)" : "var(--text)",
                      fontWeight: 500,
                      fontSize: 12,
                    }}>
                      {s.highlight ? "● " : s.alt ? "◆ " : s.over ? "✕ " : s.danger ? "▲ " : "  "}{s.label}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--text)", borderBottom: i < r.cpaScenarios.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmt(s.cpa)}
                    </td>
                    <td style={{
                      padding: "12px 8px",
                      textAlign: "right",
                      fontFamily: "'JetBrains Mono', monospace",
                      color: s.frontNetAfterAds >= 0 ? "var(--green)" : "var(--red)",
                      borderBottom: i < r.cpaScenarios.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                      {s.frontNetAfterAds >= 0 ? "+" : ""}{fmt(s.frontNetAfterAds)}
                    </td>
                    <td style={{
                      padding: "12px 8px",
                      textAlign: "right",
                      fontFamily: "'JetBrains Mono', monospace",
                      color: s.totalProfit >= 0 ? "var(--green)" : "var(--red)",
                      fontWeight: 600,
                      borderBottom: i < r.cpaScenarios.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                      {s.totalProfit >= 0 ? "+" : ""}{fmt(s.totalProfit)}
                    </td>
                    <td style={{
                      padding: "12px 8px",
                      textAlign: "right",
                      fontFamily: "'JetBrains Mono', monospace",
                      color: "var(--amber)",
                      borderBottom: i < r.cpaScenarios.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                      {fmtX(roas)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6 }}>
            <div><span style={{ color: "var(--green)" }}>●</span> Target — front-end nets ${inputs.targetFrontMargin.toFixed(0)}, full backend on top.</div>
            <div><span style={{ color: "var(--amber)" }}>◆</span> Front-end breakeven — backend = pure profit.</div>
            <div><span style={{ color: "var(--red)" }}>▲</span> Total breakeven — front-end bleeds, backend just covers it. No profit.</div>
            <div><span style={{ color: "var(--red)" }}>✕</span> Over the line — losing money even with backend.</div>
          </div>
        </div>

        {/* ========== CPC SCENARIOS ========== */}

        <div className="card">
          <SectionHeader accent="var(--cyan)">Max CPC by conversion rate</SectionHeader>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Conv rate", `Max CPC (target $${inputs.targetFrontMargin.toFixed(0)})`, "Max CPC (front BE)", "Max CPC (total BE)"].map((h, i) => (
                  <th key={i} style={{
                    textAlign: i === 0 ? "left" : "right",
                    padding: "8px 8px",
                    color: "var(--text-faint)",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    borderBottom: "1px solid var(--border)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 1.5, 2, 2.5, 3, 4, 5].map((cvrPct, i, arr) => {
                const cvr = cvrPct / 100;
                const current = Math.abs(cvrPct - inputs.conversionRate) < 0.01;
                return (
                  <tr key={cvrPct} style={{
                    background: current ? "rgba(6, 182, 212, 0.06)" : "transparent",
                  }}>
                    <td style={{
                      padding: "12px 8px",
                      fontFamily: "'JetBrains Mono', monospace",
                      color: current ? "var(--cyan)" : "var(--text)",
                      fontWeight: current ? 600 : 400,
                      borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                      {current ? "● " : "  "}{cvrPct.toFixed(1)}%
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--green)", fontWeight: 600, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmt(r.targetCPA * cvr)}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--amber)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmt(r.maxCPA_breakevenFront * cvr)}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmt(r.maxCPA_breakevenTotal * cvr)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Rebill cycle breakdown */}
        <div className="card">
          <SectionHeader accent="var(--violet)">Rebill cycle breakdown (per customer)</SectionHeader>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Cycle", "Active retention", "Revenue", "Net (after losses)"].map((h, i) => (
                  <th key={i} style={{
                    textAlign: i === 0 ? "left" : "right",
                    padding: "8px 8px",
                    color: "var(--text-faint)",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    borderBottom: "1px solid var(--border)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rebillDetails.map((d, i, arr) => (
                <tr key={i}>
                  <td style={{ padding: "12px 8px", fontFamily: "'JetBrains Mono', monospace", color: "var(--text)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                    #{d.cycle}
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                    {(d.customers * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--text)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                    {fmt(d.rev)}
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--green)", fontWeight: 600, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                    {fmt(d.net)}
                  </td>
                </tr>
              ))}
              <tr style={{ background: "rgba(34, 197, 94, 0.04)" }}>
                <td colSpan={3} style={{ padding: "14px 8px", color: "var(--green)", fontWeight: 600, fontSize: 12 }}>
                  Backend total
                </td>
                <td style={{ padding: "14px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--green)", fontWeight: 700, fontSize: 15 }}>
                  {fmt(r.backendNet)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{
          textAlign: "center",
          color: "var(--text-faint)",
          fontSize: 11,
          padding: "16px 0",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          Rebill schedule: Day 20 / 50 / 80 · All fees & losses included
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
