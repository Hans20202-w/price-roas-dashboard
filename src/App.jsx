import { useState, useMemo } from "react";

const FACTORY_DEFAULTS = {
  // Front-end inputs
  cogs: 37.56,
  txFeeRate: 7.8,
  frontCushion: 0, // $0 = breakeven front-end, $5 = slight cushion, $10 = comfortable
  // Backend rebills
  rebillPrice: 29.99,
  rebillCycles: 3,
  // Per-cycle retention: cycle 1 has biggest drop, then stabilizes
  cycleRetention: [60, 75, 80, 85, 85, 85, 85, 85, 85, 85, 85, 85],
  chargebackRate: 10,
  refundRate: 10,
  cbFee: 25,
  preAlertRate: 3,
  preAlertFee: 20,
  // Google Shopping
  conversionRate: 2.0,
  actualCPA: 0, // 0 = not provided
};

const STORAGE_KEY = "roas-calc-defaults-v4";

function loadDefaults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return FACTORY_DEFAULTS;
    return { ...FACTORY_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return FACTORY_DEFAULTS;
  }
}

// Round up to nearest $X.99
function roundToNineNine(raw) {
  const dollar = Math.floor(raw);
  return raw <= dollar + 0.99 ? dollar + 0.99 : dollar + 1 + 0.99;
}

function computeBackendNet(inputs) {
  const { rebillPrice, rebillCycles, cycleRetention, chargebackRate, refundRate, txFeeRate, cbFee, preAlertRate, preAlertFee } = inputs;
  const cbR = chargebackRate / 100;
  const refR = refundRate / 100;
  const txR = txFeeRate / 100;
  const paR = preAlertRate / 100;

  let backendNet = 0;
  let active = 1;
  const rebillDetails = [];
  for (let i = 0; i < rebillCycles; i++) {
    const cycleRet = ((cycleRetention && cycleRetention[i]) || 75) / 100;
    active = active * cycleRet;
    const rev = active * rebillPrice;
    const fees = rev * txR;
    const cbLoss = active * cbR * rebillPrice;
    const cbFees = active * cbR * cbFee;
    const refLoss = active * refR * rebillPrice;
    const alertCost = active * paR * preAlertFee;
    const net = rev - fees - cbLoss - cbFees - refLoss - alertCost;
    backendNet += net;
    rebillDetails.push({ cycle: i + 1, customers: active, rev, net, cycleRet });
  }
  return { backendNet, rebillDetails };
}

function calc(inputs) {
  const { cogs, txFeeRate, frontCushion, conversionRate } = inputs;
  const txR = txFeeRate / 100;
  const cvr = conversionRate / 100;

  const { backendNet, rebillDetails } = computeBackendNet(inputs);

  // For a target front-end cushion C: price * (1-txR) - cogs = C  →  price = (cogs + C) / (1-txR)
  const priceForCushion = (cushion) => {
    const raw = (cogs + cushion) / (1 - txR);
    return roundToNineNine(raw);
  };

  const buildScenario = (cushionTarget, label, isPrimary) => {
    const price = priceForCushion(cushionTarget);
    const frontEndGross = price - cogs - price * txR; // actual cushion (may exceed target due to .99 rounding)
    const totalNet = frontEndGross + backendNet;
    const beROAS = totalNet > 0 ? price / totalNet : Infinity;
    const maxCPA_total = totalNet;
    const maxCPA_frontBE = frontEndGross;
    const maxCPC_total = maxCPA_total * cvr;
    const maxCPC_frontBE = maxCPA_frontBE * cvr;
    return { label, isPrimary, cushionTarget, price, frontEndGross, totalNet, beROAS, maxCPA_total, maxCPA_frontBE, maxCPC_total, maxCPC_frontBE };
  };

  // The user's chosen scenario (primary)
  const primary = buildScenario(frontCushion, `Your choice ($${frontCushion} cushion)`, true);

  // 3 reference scenarios (always shown)
  const scenarios = [
    buildScenario(0, "Aggressive (breakeven front)"),
    buildScenario(5, "Balanced (+$5 cushion)"),
    buildScenario(10, "Conservative (+$10 cushion)"),
  ];

  // ROAS profit table at primary price — what you net at different real-world ROAS levels
  const roasTable = [0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0].map((roas) => {
    const adSpend = primary.price / roas;
    const profit = primary.totalNet - adSpend;
    return { roas, adSpend, profit };
  });

  // Actual numbers (if user provided their real CPA)
  const actualCPA = inputs.actualCPA;
  let actual = null;
  if (actualCPA > 0) {
    const frontAfterAds = primary.frontEndGross - actualCPA;
    const totalProfit = primary.totalNet - actualCPA;
    const actualROAS = primary.price / actualCPA;
    const vsBEROAS = actualROAS - primary.beROAS;
    let status, statusColor;
    if (totalProfit > 10) { status = "Profitable"; statusColor = "var(--green)"; }
    else if (totalProfit > 0) { status = "Marginal"; statusColor = "var(--amber)"; }
    else { status = "Bleeding"; statusColor = "var(--red)"; }
    actual = { actualCPA, frontAfterAds, totalProfit, actualROAS, vsBEROAS, status, statusColor };
  }

  return { primary, scenarios, backendNet, rebillDetails, roasTable, actual };
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
      padding: "24px 26px",
      border: `1px solid ${color}33`,
      boxShadow: `0 0 0 1px ${color}10, 0 0 30px ${glow}`,
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        color: color,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: 10,
      }}>{label}</div>
      <div style={{
        fontSize: 44,
        fontWeight: 700,
        color: color,
        letterSpacing: "-0.03em",
        lineHeight: 1,
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
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
    } catch { showToast("⚠ Could not save"); }
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
            Price & BE ROAS Calculator
          </h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14, margin: "4px 0 0" }}>
            Enter your costs → get the price to list on Shopify and your breakeven ROAS.
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

        <div className="card">
          <SectionHeader accent="var(--green)">Your front-end</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <Field label="Product cost (COGS)" value={inputs.cogs} onChange={(v) => u("cogs", v)} prefix="$" step="0.01" />
            <Field label="Transaction fee" value={inputs.txFeeRate} onChange={(v) => u("txFeeRate", v)} suffix="%" step="0.1" />
            <Field
              label="Front-end cushion"
              value={inputs.frontCushion}
              onChange={(v) => u("frontCushion", v)}
              prefix="$"
              step="1"
              hint="$0 = breakeven · $5 = slight profit · $10 = comfortable"
            />
          </div>
        </div>

        <div className="card">
          <SectionHeader accent="var(--cyan)">Backend (rebills)</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 16 }}>
            <Field label="Rebill price" value={inputs.rebillPrice} onChange={(v) => u("rebillPrice", v)} prefix="$" step="0.01" />
            <Field label="Rebill cycles" value={inputs.rebillCycles} onChange={(v) => u("rebillCycles", Math.max(1, Math.min(12, Math.round(v))))} step="1" />
            <Field label="Chargeback rate" value={inputs.chargebackRate} onChange={(v) => u("chargebackRate", v)} suffix="%" step="0.5" />
            <Field label="Refund rate" value={inputs.refundRate} onChange={(v) => u("refundRate", v)} suffix="%" step="0.5" />
            <Field label="Chargeback fee" value={inputs.cbFee} onChange={(v) => u("cbFee", v)} prefix="$" step="1" />
            <Field label="Pre-alert rate" value={inputs.preAlertRate} onChange={(v) => u("preAlertRate", v)} suffix="%" step="0.5" />
            <Field label="Pre-alert fee" value={inputs.preAlertFee} onChange={(v) => u("preAlertFee", v)} prefix="$" step="1" />
          </div>

          {/* Per-cycle retention */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", marginBottom: 4 }}>
              Retention per cycle
            </div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 12, lineHeight: 1.5 }}>
              What % of <em>previous-cycle</em> active customers continue. Cycle 1 typically has the biggest drop (refunds, CBs, fast cancels) — later cycles stabilize.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
              {Array.from({ length: inputs.rebillCycles }).map((_, i) => (
                <Field
                  key={i}
                  label={`Cycle ${i + 1}`}
                  value={inputs.cycleRetention[i] ?? 80}
                  onChange={(v) => {
                    const next = [...(inputs.cycleRetention || [])];
                    while (next.length < inputs.rebillCycles) next.push(80);
                    next[i] = v;
                    u("cycleRetention", next);
                  }}
                  suffix="%"
                  step="1"
                />
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <SectionHeader accent="var(--amber)">Google Shopping</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <Field label="Conversion rate" value={inputs.conversionRate} onChange={(v) => u("conversionRate", v)} suffix="%" step="0.1" hint="Clicks → sales · typical 1–4%" />
            <Field
              label="Your actual CPA"
              value={inputs.actualCPA}
              onChange={(v) => u("actualCPA", v)}
              prefix="$"
              step="0.5"
              hint="Optional · leave 0 if you don't have one yet"
            />
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
          <SectionHeader accent="var(--green)">Your results</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <ResultTile
              label="List your product at"
              value={fmt(r.primary.price)}
              sub={`Front-end nets ${fmt(r.primary.frontEndGross)} (before ads)`}
              color="var(--green)"
              glow="var(--green-glow)"
            />
            <ResultTile
              label="Your BE ROAS"
              value={fmtX(r.primary.beROAS)}
              sub={`Above this = profit · below = bleeding`}
              color="var(--cyan)"
              glow="var(--cyan-glow)"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <MiniStat label="Max CPA" value={fmt(r.primary.maxCPA_total)} color="var(--green)" hint="overall breakeven" />
            <MiniStat label="Max CPC" value={fmt(r.primary.maxCPC_total)} color="var(--cyan)" hint={`at ${inputs.conversionRate.toFixed(1)}% CVR`} />
            <MiniStat label="Backend net" value={fmt(r.backendNet)} color="var(--violet)" hint={`${inputs.rebillCycles} rebills`} />
            <MiniStat label="Total / customer" value={fmt(r.primary.totalNet)} color="var(--text)" hint="front + back, pre-ads" />
          </div>
        </div>

        {/* ========== YOUR ACTUAL NUMBERS (only if CPA provided) ========== */}

        {r.actual && (
          <div style={{
            position: "relative",
            background: r.actual.totalProfit >= 0
              ? "radial-gradient(ellipse at top right, var(--green-glow), transparent 60%), var(--bg-elev)"
              : "radial-gradient(ellipse at top right, rgba(239, 68, 68, 0.15), transparent 60%), var(--bg-elev)",
            borderRadius: 20,
            padding: 28,
            border: `1px solid ${r.actual.statusColor}33`,
            marginBottom: 16,
          }}>
            <SectionHeader
              accent={r.actual.statusColor}
              badge={
                <span style={{
                  fontSize: 10,
                  color: r.actual.statusColor,
                  background: `${r.actual.statusColor}15`,
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: `1px solid ${r.actual.statusColor}33`,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginLeft: 8,
                }}>
                  {r.actual.status}
                </span>
              }
            >
              Your actual numbers (at ${r.actual.actualCPA.toFixed(2)} CPA)
            </SectionHeader>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <MiniStat
                label="Profit / customer"
                value={(r.actual.totalProfit >= 0 ? "+" : "") + fmt(r.actual.totalProfit)}
                color={r.actual.totalProfit >= 0 ? "var(--green)" : "var(--red)"}
                hint="after ads + backend"
              />
              <MiniStat
                label="Front-end after ads"
                value={(r.actual.frontAfterAds >= 0 ? "+" : "") + fmt(r.actual.frontAfterAds)}
                color={r.actual.frontAfterAds >= 0 ? "var(--green)" : "var(--red)"}
                hint="before backend kicks in"
              />
              <MiniStat
                label="Your actual ROAS"
                value={fmtX(r.actual.actualROAS)}
                color="var(--cyan)"
                hint={`BE is ${fmtX(r.primary.beROAS)}`}
              />
              <MiniStat
                label="vs BE ROAS"
                value={(r.actual.vsBEROAS >= 0 ? "+" : "") + r.actual.vsBEROAS.toFixed(2) + "x"}
                color={r.actual.vsBEROAS >= 0 ? "var(--green)" : "var(--red)"}
                hint={r.actual.vsBEROAS >= 0 ? "above breakeven" : "below breakeven"}
              />
            </div>
          </div>
        )}

        {/* ========== PRICE OPTIONS (3 cushion levels) ========== */}

        <div className="card">
          <SectionHeader accent="var(--violet)">Price options by front-end cushion</SectionHeader>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Strategy", "Price", "Front cushion", "Backend net", "BE ROAS", "Max CPC"].map((h, i) => (
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
              {r.scenarios.map((s, i, arr) => {
                const isYours = Math.abs(s.cushionTarget - inputs.frontCushion) < 0.5;
                return (
                  <tr key={i} style={{ background: isYours ? "rgba(34, 197, 94, 0.06)" : "transparent" }}>
                    <td style={{
                      padding: "12px 8px",
                      color: isYours ? "var(--green)" : "var(--text)",
                      fontWeight: isYours ? 600 : 500,
                      fontSize: 12,
                      borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                      {isYours ? "● " : "  "}{s.label}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--text)", fontWeight: 600, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmt(s.price)}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--green)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmt(s.frontEndGross)}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--violet)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmt(r.backendNet)}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--cyan)", fontWeight: 600, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmtX(s.beROAS)}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--amber)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmt(s.maxCPC_total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)" }}>
            Pick your strategy by changing the <strong style={{ color: "var(--text-dim)" }}>Front-end cushion</strong> input above.
          </div>
        </div>

        {/* ========== ROAS SCENARIOS ========== */}

        <div className="card">
          <SectionHeader accent="var(--amber)">
            Profit at different ROAS levels
            <span style={{ color: "var(--text-faint)", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
              (at {fmt(r.primary.price)})
            </span>
          </SectionHeader>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["ROAS", "Ad spend / cust", "Profit / cust", ""].map((h, i) => (
                  <th key={i} style={{
                    textAlign: i === 0 ? "left" : i === 3 ? "left" : "right",
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
              {r.roasTable.map((row, i, arr) => {
                const isBE = Math.abs(row.roas - r.primary.beROAS) < 0.15;
                const status = row.profit > 15 ? "healthy" : row.profit > 0 ? "marginal" : "bleeding";
                const statusColor = row.profit > 15 ? "var(--green)" : row.profit > 0 ? "var(--amber)" : "var(--red)";
                return (
                  <tr key={i} style={{ background: isBE ? "rgba(6, 182, 212, 0.06)" : "transparent" }}>
                    <td style={{ padding: "12px 8px", fontFamily: "'JetBrains Mono', monospace", color: isBE ? "var(--cyan)" : "var(--text)", fontWeight: isBE ? 600 : 400, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {isBE ? "● " : "  "}{row.roas.toFixed(1)}x{isBE ? " (≈BE)" : ""}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--amber)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {fmt(row.adSpend)}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: row.profit >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      {row.profit >= 0 ? "+" : ""}{fmt(row.profit)}
                    </td>
                    <td style={{ padding: "12px 8px", fontSize: 11, color: statusColor, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      ● {status}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ========== REBILL BREAKDOWN ========== */}

        <div className="card">
          <SectionHeader accent="var(--cyan)">Rebill cycle breakdown</SectionHeader>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Cycle", "Retention", "Still active", "Revenue", "Net (after losses)"].map((h, i) => (
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
                  <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--cyan)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                    {(d.cycleRet * 100).toFixed(0)}%
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
                <td colSpan={4} style={{ padding: "14px 8px", color: "var(--green)", fontWeight: 600, fontSize: 12 }}>
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
