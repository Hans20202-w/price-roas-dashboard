import { useState, useMemo } from "react";

const FACTORY_DEFAULTS = {
  // Front-end inputs
  cogs: 37.56,
  txFeeRate: 7.8,
  frontCushion: 0, // $0 = breakeven front-end, $5 = slight cushion, $10 = comfortable
  // Backend rebills
  rebillPrice: 29.99,
  rebillCycles: 3,
  // Per-cycle retention
  cycleRetention: [90, 70, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90],
  chargebackRate: 3,
  refundRate: 10,
  cbFee: 25,
  preAlertRate: 10,
  preAlertFee: 20,
  // Google Shopping
  conversionRate: 2.0,
  actualCPA: 0, // 0 = not provided
  customPrice: 0, // 0 = not set; user types their own price to compare
  // Current Google Ads data (no rebills) — for price-change projection
  currentPrice: 114.99,
  currentCPA: 36.63,
  currentCPC: 1.03,
  cvrElasticity: 0.5, // how much CVR scales with price (0 = no response, 1 = inversely proportional)
  cpcElasticity: 0.1, // how much CPC scales with price (gentle)
  // Monthly goal
  monthlyGoal: 100000, // target net profit per month
};

const STORAGE_KEY = "roas-calc-defaults-v5";

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

  const buildScenarioFromPrice = (price, label, opts = {}) => {
    const frontEndGross = price - cogs - price * txR;
    const totalNet = frontEndGross + backendNet;
    const beROAS = totalNet > 0 ? price / totalNet : Infinity;
    const maxCPA_total = totalNet;
    const maxCPA_frontBE = frontEndGross;
    const maxCPC_total = maxCPA_total * cvr;
    const maxCPC_frontBE = maxCPA_frontBE * cvr;
    return { label, ...opts, price, frontEndGross, totalNet, beROAS, maxCPA_total, maxCPA_frontBE, maxCPC_total, maxCPC_frontBE };
  };

  const buildScenario = (cushionTarget, label, isPrimary) => {
    const price = priceForCushion(cushionTarget);
    return buildScenarioFromPrice(price, label, { cushionTarget, isPrimary });
  };

  // The user's chosen scenario (primary)
  const primary = buildScenario(frontCushion, `Your choice ($${frontCushion} cushion)`, true);

  // 3 reference scenarios (always shown)
  const scenarios = [
    buildScenario(0, "Aggressive (breakeven front)"),
    buildScenario(5, "Balanced (+$5 cushion)"),
    buildScenario(10, "Conservative (+$10 cushion)"),
  ];

  // Custom price scenario (user-entered)
  const custom = inputs.customPrice > 0 ? buildScenarioFromPrice(inputs.customPrice, "Your custom price") : null;

  // ACTIVE scenario — what the rest of the dashboard uses. Custom wins if set, else primary.
  const active = custom || primary;
  const usingCustom = !!custom;

  // ROAS profit table at active price
  const roasTable = [0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0].map((roas) => {
    const adSpend = active.price / roas;
    const profit = active.totalNet - adSpend;
    return { roas, adSpend, profit };
  });

  // Actual numbers (if user provided their real CPA) — uses active scenario
  const actualCPA = inputs.actualCPA;
  let actual = null;
  if (actualCPA > 0) {
    const frontAfterAds = active.frontEndGross - actualCPA;
    const totalProfit = active.totalNet - actualCPA;
    const actualROAS = active.price / actualCPA;
    const vsBEROAS = actualROAS - active.beROAS;
    let status, statusColor;
    if (totalProfit > 10) { status = "Profitable"; statusColor = "var(--green)"; }
    else if (totalProfit > 0) { status = "Marginal"; statusColor = "var(--amber)"; }
    else { status = "Bleeding"; statusColor = "var(--red)"; }
    actual = { actualCPA, frontAfterAds, totalProfit, actualROAS, vsBEROAS, status, statusColor };
  }

  // ========== SPECULATION / PAYBACK ==========
  // Use actualCPA if set, otherwise the max CPA at the active scenario (so user always sees something)
  const specCPA = actualCPA > 0 ? actualCPA : active.maxCPA_total;
  const specCPAIsFromActual = actualCPA > 0;

  // Cycle-by-cycle cumulative cashflow per customer
  const projection = [];
  // Cycle 0: initial sale, paid CPA upfront
  let cumNet = active.frontEndGross - specCPA;
  projection.push({
    cycle: 0,
    label: "Initial sale (− CPA)",
    netThisCycle: cumNet,
    cumNet,
    cumRev: active.price,
  });
  let cumRev = active.price;
  rebillDetails.forEach((d) => {
    cumNet += d.net;
    cumRev += d.rev;
    projection.push({
      cycle: d.cycle,
      label: `Rebill #${d.cycle}`,
      netThisCycle: d.net,
      cumNet,
      cumRev,
    });
  });

  const finalNet = cumNet;
  const paybackRow = projection.find((p) => p.cumNet >= 0);
  const paybackCycle = paybackRow ? paybackRow.cycle : null;
  const effectiveCPA = specCPA - backendNet; // negative = backend more than pays for acquisition
  const frontROAS = active.price / specCPA;
  const totalROAS = cumRev / specCPA;

  // ========== REBILL ADVANTAGE ==========
  // "Without rebills" scenario at the same active price: backend = 0
  const noRebill_maxCPA = active.frontEndGross; // only front-end gross funds ad spend
  const noRebill_maxCPC = noRebill_maxCPA * cvr;
  const noRebill_beROAS = active.frontEndGross > 0 ? active.price / active.frontEndGross : Infinity;

  // What price would you need WITHOUT rebills to afford the same Max CPA as with rebills?
  // price - cogs - price*txR = active.maxCPA_total  →  price = (cogs + maxCPA) / (1-txR)
  const noRebill_priceNeededRaw = (cogs + active.maxCPA_total) / (1 - txR);
  const noRebill_priceNeeded = roundToNineNine(noRebill_priceNeededRaw);
  const priceSavings = noRebill_priceNeeded - active.price;

  const cpaAdvantage = active.maxCPA_total - noRebill_maxCPA; // = backendNet
  const cpcAdvantage = active.maxCPC_total - noRebill_maxCPC;
  const advantageMultiplier = noRebill_maxCPA > 0.01 ? active.maxCPA_total / noRebill_maxCPA : Infinity;

  // ========== PRICE CHANGE PROJECTION ==========
  // Given current Google Ads data at currentPrice, project new CVR/CPC/CPA at active.price
  const { currentPrice, currentCPA, currentCPC, cvrElasticity, cpcElasticity } = inputs;
  let projection_cvr = null;
  if (currentCPA > 0 && currentCPC > 0 && currentPrice > 0 && active.price > 0) {
    const currentCVR_pct = (currentCPC / currentCPA) * 100; // %
    // CVR rises as price drops: newCVR = currentCVR × (currentPrice / newPrice)^elasticity
    const priceRatio = currentPrice / active.price;
    const newCVR_pct = currentCVR_pct * Math.pow(priceRatio, cvrElasticity);
    // CPC falls gently as price drops: newCPC = currentCPC × (newPrice / currentPrice)^cpcElasticity
    const newCPC = currentCPC * Math.pow(active.price / currentPrice, cpcElasticity);
    const newCPA = newCVR_pct > 0 ? newCPC / (newCVR_pct / 100) : Infinity;

    // Profit comparison (per customer)
    const currentProfit = currentPrice - cogs - currentPrice * txR - currentCPA; // no rebills
    const newProfit = active.frontEndGross + backendNet - newCPA; // with rebills

    // Diffs
    const cpaDiff = currentCPA - newCPA;
    const cpaDiffPct = currentCPA > 0 ? (cpaDiff / currentCPA) * 100 : 0;
    const cpcDiff = currentCPC - newCPC;
    const cpcDiffPct = currentCPC > 0 ? (cpcDiff / currentCPC) * 100 : 0;
    const cvrDiff = newCVR_pct - currentCVR_pct;
    const profitDiff = newProfit - currentProfit;

    projection_cvr = {
      currentCVR_pct, currentCPA, currentCPC, currentPrice, currentProfit,
      newCVR_pct, newCPC, newCPA, newProfit,
      cpaDiff, cpaDiffPct, cpcDiff, cpcDiffPct, cvrDiff, profitDiff,
    };
  }

  // ========== MONTHLY GOAL CALCULATOR ==========
  // Pick best available profit/customer and CPA estimate
  let goal = null;
  const goalProfit = inputs.monthlyGoal;
  if (goalProfit > 0) {
    let profitPerCust, goalCPA, cvrForGoal;
    let source;
    if (projection_cvr && projection_cvr.newProfit > 0) {
      profitPerCust = projection_cvr.newProfit;
      goalCPA = projection_cvr.newCPA;
      cvrForGoal = projection_cvr.newCVR_pct; // %
      source = "projected (with rebills)";
    } else if (actual && actual.totalProfit > 0) {
      profitPerCust = actual.totalProfit;
      goalCPA = actualCPA;
      cvrForGoal = inputs.conversionRate;
      source = "your actual CPA";
    } else {
      profitPerCust = active.totalNet - specCPA;
      goalCPA = specCPA;
      cvrForGoal = inputs.conversionRate;
      source = "max-CPA scenario";
    }

    if (profitPerCust > 0 && goalCPA > 0) {
      const customersNeeded = goalProfit / profitPerCust;
      const dailyCustomers = customersNeeded / 30;
      const monthlyAdSpend = customersNeeded * goalCPA;
      const dailyAdSpend = monthlyAdSpend / 30;
      const clicksNeeded = cvrForGoal > 0 ? customersNeeded / (cvrForGoal / 100) : null;
      const dailyClicks = clicksNeeded ? clicksNeeded / 30 : null;
      const feRevenue = customersNeeded * active.price;
      const cumBeRev = rebillDetails.reduce((sum, d) => sum + d.rev, 0);
      const beRevenue = customersNeeded * cumBeRev;
      const totalRevenue = feRevenue + beRevenue;
      const netCashflow = totalRevenue - monthlyAdSpend - (customersNeeded * cogs); // rough
      goal = {
        goalProfit, profitPerCust, cpa: goalCPA, cvr: cvrForGoal, source,
        customersNeeded, dailyCustomers,
        monthlyAdSpend, dailyAdSpend,
        clicksNeeded, dailyClicks,
        feRevenue, beRevenue, totalRevenue,
      };
    } else {
      goal = { error: "Profit per customer is zero or negative — fix inputs first.", source };
    }
  }

  return {
    primary, scenarios, custom, active, usingCustom,
    backendNet, rebillDetails, roasTable, actual,
    projection, specCPA, specCPAIsFromActual, finalNet, paybackCycle, effectiveCPA, frontROAS, totalROAS,
    noRebill_maxCPA, noRebill_maxCPC, noRebill_beROAS, noRebill_priceNeeded,
    priceSavings, cpaAdvantage, cpcAdvantage, advantageMultiplier,
    projection_cvr,
    goal,
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
  // Separate "snapshot" state — results only update when user clicks Calculate
  const [calculatedInputs, setCalculatedInputs] = useState(loadDefaults);
  const [toast, setToast] = useState(null);
  const r = useMemo(() => calc(calculatedInputs), [calculatedInputs]);

  const u = (k, v) => setInputs((p) => ({ ...p, [k]: v }));
  const fmt = (n) => (n === Infinity ? "∞" : "$" + n.toFixed(2));
  const fmtX = (n) => (n === Infinity ? "∞" : n.toFixed(2) + "x");

  // Inputs are "stale" when they differ from what was last calculated
  const isStale = JSON.stringify(inputs) !== JSON.stringify(calculatedInputs);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const calculate = () => {
    setCalculatedInputs(inputs);
    showToast("✓ Calculated");
  };

  const saveAsDefaults = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
      showToast("✓ Saved as your defaults");
    } catch { showToast("⚠ Could not save"); }
  };
  const resetToSaved = () => {
    const d = loadDefaults();
    setInputs(d);
    setCalculatedInputs(d);
    showToast("↻ Reset to saved defaults");
  };
  const resetToFactory = () => {
    setInputs(FACTORY_DEFAULTS);
    setCalculatedInputs(FACTORY_DEFAULTS);
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


        {/* ========== CALCULATE BUTTON ========== */}

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
          padding: "16px 20px",
          background: isStale ? "rgba(245, 158, 11, 0.06)" : "var(--bg-elev)",
          border: `1px solid ${isStale ? "rgba(245, 158, 11, 0.3)" : "var(--border)"}`,
          borderRadius: 14,
          transition: "all 0.2s ease",
        }}>
          <button
            onClick={calculate}
            disabled={!isStale}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.01em",
              padding: "12px 28px",
              borderRadius: 10,
              border: "none",
              background: isStale ? "var(--green)" : "var(--bg-elev-2)",
              color: isStale ? "#000" : "var(--text-faint)",
              cursor: isStale ? "pointer" : "default",
              transition: "all 0.15s ease",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              boxShadow: isStale ? "0 0 24px rgba(34, 197, 94, 0.35)" : "none",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
            Calculate
          </button>
          <div style={{ fontSize: 13, color: isStale ? "var(--amber)" : "var(--text-faint)", flex: 1 }}>
            {isStale ? (
              <>
                <strong style={{ color: "var(--amber)" }}>● Inputs changed</strong> — click Calculate to update the results below.
              </>
            ) : (
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                ✓ Results are up to date.
              </span>
            )}
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
              value={fmt(r.active.price)}
              sub={r.usingCustom ? `Your custom price · front nets ${fmt(r.active.frontEndGross)}` : `Front-end nets ${fmt(r.active.frontEndGross)} (before ads)`}
              color="var(--green)"
              glow="var(--green-glow)"
            />
            <ResultTile
              label="Your BE ROAS"
              value={fmtX(r.active.beROAS)}
              sub={`Above this = profit · below = bleeding`}
              color="var(--cyan)"
              glow="var(--cyan-glow)"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <MiniStat label="Max CPA" value={fmt(r.active.maxCPA_total)} color="var(--green)" hint="overall breakeven" />
            <MiniStat label="Max CPC" value={fmt(r.active.maxCPC_total)} color="var(--cyan)" hint={`at ${calculatedInputs.conversionRate.toFixed(1)}% CVR`} />
            <MiniStat label="Backend net" value={fmt(r.backendNet)} color="var(--violet)" hint={`${calculatedInputs.rebillCycles} rebills`} />
            <MiniStat label="Total / customer" value={fmt(r.active.totalNet)} color="var(--text)" hint="front + back, pre-ads" />
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
                hint={`BE is ${fmtX(r.active.beROAS)}`}
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

        {/* ========== SPECULATION / PAYBACK ========== */}

        <div style={{
          position: "relative",
          background: r.finalNet >= 0
            ? "radial-gradient(ellipse at top right, var(--green-glow), transparent 70%), var(--bg-elev)"
            : "radial-gradient(ellipse at top right, rgba(239, 68, 68, 0.12), transparent 70%), var(--bg-elev)",
          borderRadius: 20,
          padding: 28,
          border: `1px solid ${r.finalNet >= 0 ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
          marginBottom: 16,
        }}>
          <SectionHeader
            accent={r.finalNet >= 0 ? "var(--green)" : "var(--red)"}
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
                {r.specCPAIsFromActual ? "using your actual CPA" : "using max CPA (no actual set)"}
              </span>
            }
          >
            Speculation — payback over time
          </SectionHeader>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 18, lineHeight: 1.5 }}>
            If you sell at <strong style={{ color: "var(--text)" }}>{fmt(r.active.price)}</strong> and pay <strong style={{ color: "var(--text)" }}>{fmt(r.specCPA)}</strong> CPA, here's the cumulative profit per customer over each rebill cycle.
            {!r.specCPAIsFromActual && (
              <span style={{ color: "var(--amber)" }}> Set "Your actual CPA" above to use your real Google Ads number.</span>
            )}
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <MiniStat
              label="Final profit / cust"
              value={(r.finalNet >= 0 ? "+" : "") + fmt(r.finalNet)}
              color={r.finalNet >= 0 ? "var(--green)" : "var(--red)"}
              hint="after all rebills"
            />
            <MiniStat
              label="Payback at"
              value={r.paybackCycle === null ? "Never" : r.paybackCycle === 0 ? "Day 1" : `Cycle #${r.paybackCycle}`}
              color={r.paybackCycle === null ? "var(--red)" : r.paybackCycle === 0 ? "var(--green)" : "var(--amber)"}
              hint={r.paybackCycle === null ? "CPA too high" : r.paybackCycle === 0 ? "instantly profitable" : `${r.paybackCycle} rebill(s) needed`}
            />
            <MiniStat
              label="Effective CPA"
              value={(r.effectiveCPA < 0 ? "−" : "") + fmt(Math.abs(r.effectiveCPA))}
              color={r.effectiveCPA < 0 ? "var(--green)" : r.effectiveCPA < r.specCPA / 2 ? "var(--amber)" : "var(--red)"}
              hint={r.effectiveCPA < 0 ? "backend pays you back!" : "after backend"}
            />
            <MiniStat
              label="Total ROAS"
              value={fmtX(r.totalROAS)}
              color="var(--cyan)"
              hint={`front-end is ${fmtX(r.frontROAS)}`}
            />
          </div>

          {/* Cycle-by-cycle table */}
          <div style={{ background: "var(--bg-elev-2)", borderRadius: 12, padding: "4px 12px", border: "1px solid var(--border)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["Cycle", "Event", "Net this cycle", "Cumulative", ""].map((h, i) => (
                    <th key={i} style={{
                      textAlign: i <= 1 ? "left" : i === 4 ? "left" : "right",
                      padding: "10px 8px",
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
                {r.projection.map((p, i, arr) => {
                  const isPayback = r.paybackCycle !== null && p.cycle === r.paybackCycle && p.cycle > 0;
                  const statusColor = p.cumNet >= 0 ? "var(--green)" : "var(--red)";
                  const statusLabel = p.cumNet >= 0 ? (isPayback ? "● Paid back" : "● In profit") : "● Underwater";
                  return (
                    <tr key={i} style={{
                      background: isPayback ? "rgba(34, 197, 94, 0.08)" : "transparent",
                    }}>
                      <td style={{ padding: "12px 8px", fontFamily: "'JetBrains Mono', monospace", color: "var(--text)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                        #{p.cycle}
                      </td>
                      <td style={{ padding: "12px 8px", color: p.cycle === 0 ? "var(--text)" : "var(--text-dim)", fontSize: 12, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                        {p.label}
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: p.netThisCycle >= 0 ? "var(--green)" : "var(--red)", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                        {(p.netThisCycle >= 0 ? "+" : "") + fmt(p.netThisCycle)}
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: statusColor, fontWeight: 700, fontSize: 14, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                        {(p.cumNet >= 0 ? "+" : "") + fmt(p.cumNet)}
                      </td>
                      <td style={{ padding: "12px 8px", fontSize: 11, color: statusColor, fontWeight: isPayback ? 600 : 400, borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                        {statusLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {r.effectiveCPA < 0 && (
            <div style={{
              marginTop: 16,
              padding: "12px 16px",
              background: "rgba(34, 197, 94, 0.08)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              borderRadius: 10,
              fontSize: 12,
              color: "var(--text)",
              lineHeight: 1.5,
            }}>
              <strong style={{ color: "var(--green)" }}>💰 Effective CPA is negative.</strong>{" "}
              Your backend ({fmt(r.backendNet)}) more than pays for your CPA ({fmt(r.specCPA)}). You can theoretically scale ad spend higher — the cap is volume and your CVR holding up.
            </div>
          )}
        </div>

        {/* ========== PRICE CHANGE PROJECTION ========== */}

        <div style={{
          position: "relative",
          background: "radial-gradient(ellipse at top right, rgba(139, 92, 246, 0.12), transparent 70%), radial-gradient(ellipse at bottom left, var(--green-glow), transparent 70%), var(--bg-elev)",
          borderRadius: 20,
          padding: 28,
          border: "1px solid rgba(139, 92, 246, 0.2)",
          marginBottom: 16,
        }}>
          <SectionHeader accent="var(--violet)">
            Price change projection
            <span style={{ color: "var(--text-faint)", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
              · what Google likely gives at the new price
            </span>
          </SectionHeader>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 18, lineHeight: 1.5 }}>
            Type your real Google Ads numbers below (current price, CPA, CPC — no rebills). The right side projects what they'll likely become at the new price. Elasticity = how much you expect CVR/CPC to respond to price changes.
          </div>

          {/* Side-by-side comparison */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
            {/* CURRENT — INLINE EDITABLE */}
            <div style={{
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 20,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Current · no rebills
              </div>

              {/* Price (large editable) */}
              <div style={{ marginBottom: 12, display: "flex", alignItems: "baseline", gap: 2 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>$</span>
                <input
                  type="number"
                  value={inputs.currentPrice || ""}
                  placeholder="0"
                  onChange={(e) => u("currentPrice", parseFloat(e.target.value) || 0)}
                  step="0.01"
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px dashed var(--border-strong)",
                    outline: "none",
                    color: "var(--text)",
                    fontSize: 24,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    width: 130,
                    padding: "2px 4px",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              <div style={{ display: "grid", gap: 8, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                {/* CPA editable */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--text-faint)" }}>CPA</span>
                  <span style={{ color: "var(--text)", fontWeight: 600, display: "inline-flex", alignItems: "baseline" }}>
                    $
                    <input
                      type="number"
                      value={inputs.currentCPA || ""}
                      placeholder="0"
                      onChange={(e) => u("currentCPA", parseFloat(e.target.value) || 0)}
                      step="0.01"
                      style={{
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px dashed var(--border-strong)",
                        outline: "none",
                        color: "var(--text)",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 13,
                        fontWeight: 600,
                        width: 70,
                        textAlign: "right",
                        padding: "1px 2px",
                      }}
                    />
                  </span>
                </div>

                {/* CPC editable */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--text-faint)" }}>CPC</span>
                  <span style={{ color: "var(--text)", fontWeight: 600, display: "inline-flex", alignItems: "baseline" }}>
                    $
                    <input
                      type="number"
                      value={inputs.currentCPC || ""}
                      placeholder="0"
                      onChange={(e) => u("currentCPC", parseFloat(e.target.value) || 0)}
                      step="0.01"
                      style={{
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px dashed var(--border-strong)",
                        outline: "none",
                        color: "var(--text)",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 13,
                        fontWeight: 600,
                        width: 70,
                        textAlign: "right",
                        padding: "1px 2px",
                      }}
                    />
                  </span>
                </div>

                {/* CVR derived */}
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-faint)" }}>CVR <span style={{ fontSize: 10, color: "var(--text-faint)", opacity: 0.6 }}>(derived)</span></span>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>
                    {r.projection_cvr ? r.projection_cvr.currentCVR_pct.toFixed(2) + "%" : "—"}
                  </span>
                </div>

                {/* Profit derived */}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-faint)" }}>Profit / cust</span>
                  <span style={{ color: r.projection_cvr && r.projection_cvr.currentProfit >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                    {r.projection_cvr
                      ? (r.projection_cvr.currentProfit >= 0 ? "+" : "") + fmt(r.projection_cvr.currentProfit)
                      : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* NEW PROJECTED */}
            <div style={{
              background: "rgba(34, 197, 94, 0.05)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              borderRadius: 14,
              padding: 20,
              boxShadow: "0 0 30px var(--green-glow)",
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Projected · with rebills
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--green)", letterSpacing: "-0.02em", marginBottom: 12 }}>
                {fmt(r.active.price)}
              </div>
              <div style={{ display: "grid", gap: 8, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-faint)" }}>CPA</span>
                  <span style={{ color: "var(--green)", fontWeight: 600 }}>
                    {r.projection_cvr ? fmt(r.projection_cvr.newCPA) : "—"}
                    {r.projection_cvr && (
                      <span style={{ fontSize: 10, color: r.projection_cvr.cpaDiff > 0 ? "var(--green)" : "var(--red)", marginLeft: 6 }}>
                        ({r.projection_cvr.cpaDiff > 0 ? "−" : "+"}{Math.abs(r.projection_cvr.cpaDiffPct).toFixed(0)}%)
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-faint)" }}>CPC</span>
                  <span style={{ color: "var(--green)", fontWeight: 600 }}>
                    {r.projection_cvr ? fmt(r.projection_cvr.newCPC) : "—"}
                    {r.projection_cvr && (
                      <span style={{ fontSize: 10, color: r.projection_cvr.cpcDiff > 0 ? "var(--green)" : "var(--red)", marginLeft: 6 }}>
                        ({r.projection_cvr.cpcDiff > 0 ? "−" : "+"}{Math.abs(r.projection_cvr.cpcDiffPct).toFixed(0)}%)
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-faint)" }}>CVR</span>
                  <span style={{ color: "var(--green)", fontWeight: 600 }}>
                    {r.projection_cvr ? r.projection_cvr.newCVR_pct.toFixed(2) + "%" : "—"}
                    {r.projection_cvr && (
                      <span style={{ fontSize: 10, color: r.projection_cvr.cvrDiff > 0 ? "var(--green)" : "var(--red)", marginLeft: 6 }}>
                        ({r.projection_cvr.cvrDiff > 0 ? "+" : ""}{r.projection_cvr.cvrDiff.toFixed(2)}pp)
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: "1px solid rgba(34, 197, 94, 0.2)" }}>
                  <span style={{ color: "var(--text-faint)" }}>Profit / cust</span>
                  <span style={{ color: r.projection_cvr && r.projection_cvr.newProfit >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                    {r.projection_cvr
                      ? (r.projection_cvr.newProfit >= 0 ? "+" : "") + fmt(r.projection_cvr.newProfit)
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Summary callout */}
          {r.projection_cvr && (
            <div style={{
              padding: "14px 18px",
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              fontSize: 13,
              color: "var(--text)",
              lineHeight: 1.6,
              marginBottom: 14,
            }}>
              <strong style={{ color: r.projection_cvr.profitDiff >= 0 ? "var(--green)" : "var(--red)" }}>
                {r.projection_cvr.profitDiff >= 0 ? "↑" : "↓"} {(r.projection_cvr.profitDiff >= 0 ? "+" : "") + fmt(r.projection_cvr.profitDiff)} per customer
              </strong>{" "}
              by moving from <strong>{fmt(r.projection_cvr.currentPrice)}</strong> (no rebills) to <strong>{fmt(r.active.price)}</strong> (with rebills). Estimated CPA drop:{" "}
              <strong style={{ color: "var(--green)" }}>−{r.projection_cvr.cpaDiffPct.toFixed(0)}%</strong> (${r.projection_cvr.currentCPA.toFixed(2)} → ${r.projection_cvr.newCPA.toFixed(2)}).
            </div>
          )}

          {/* Elasticity controls — compact footer */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            padding: "12px 16px",
            background: "var(--bg-elev-2)",
            borderRadius: 10,
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                CVR elasticity
              </span>
              <input
                type="number"
                value={inputs.cvrElasticity}
                onChange={(e) => u("cvrElasticity", Math.max(0, Math.min(2, parseFloat(e.target.value) || 0)))}
                step="0.1"
                style={{
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  outline: "none",
                  color: "var(--text)",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  width: 60,
                  padding: "4px 6px",
                  textAlign: "center",
                }}
              />
              <span style={{ fontSize: 10, color: "var(--text-faint)" }}>0=none · 0.5=mid · 1=strong</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                CPC elasticity
              </span>
              <input
                type="number"
                value={inputs.cpcElasticity}
                onChange={(e) => u("cpcElasticity", Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
                step="0.05"
                style={{
                  background: "var(--bg-elev)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  outline: "none",
                  color: "var(--text)",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  width: 60,
                  padding: "4px 6px",
                  textAlign: "center",
                }}
              />
              <span style={{ fontSize: 10, color: "var(--text-faint)" }}>0.1=gentle · 0.3=steep</span>
            </div>
          </div>
        </div>

        {/* ========== MONTHLY GOAL CALCULATOR ========== */}

        <div style={{
          position: "relative",
          background: "radial-gradient(ellipse at top left, rgba(245, 158, 11, 0.10), transparent 60%), var(--bg-elev)",
          borderRadius: 20,
          padding: 28,
          border: "1px solid rgba(245, 158, 11, 0.2)",
          marginBottom: 16,
        }}>
          <SectionHeader accent="var(--amber)">
            Monthly goal — what scale do you need?
            {r.goal && r.goal.source && (
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
                using: {r.goal.source}
              </span>
            )}
          </SectionHeader>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 18, lineHeight: 1.5 }}>
            Type your target monthly profit. Dashboard calculates customers needed (over their lifetime including rebills), ad spend, daily volume, and required clicks.
          </div>

          {/* Goal input — big */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 24,
            flexWrap: "wrap",
            padding: "16px 20px",
            background: "var(--bg-elev-2)",
            borderRadius: 12,
            border: "1px solid var(--border)",
          }}>
            <span style={{
              fontSize: 11,
              color: "var(--text-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}>
              I want
            </span>
            <div style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: "var(--amber)" }}>$</span>
              <input
                type="number"
                value={inputs.monthlyGoal || ""}
                placeholder="100000"
                onChange={(e) => u("monthlyGoal", parseFloat(e.target.value) || 0)}
                step="1000"
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px dashed var(--border-strong)",
                  outline: "none",
                  color: "var(--text)",
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  width: 180,
                  padding: "2px 4px",
                  fontFamily: "inherit",
                }}
              />
            </div>
            <span style={{ fontSize: 14, color: "var(--text-dim)" }}>
              profit per month
            </span>
          </div>

          {r.goal && r.goal.error && (
            <div style={{
              padding: "14px 18px",
              background: "rgba(239, 68, 68, 0.06)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: 12,
              fontSize: 13,
              color: "var(--red)",
            }}>
              {r.goal.error}
            </div>
          )}

          {r.goal && !r.goal.error && (
            <>
              {/* Main stats — what you need */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                <MiniStat
                  label="Customers / month"
                  value={Math.ceil(r.goal.customersNeeded).toLocaleString()}
                  color="var(--green)"
                  hint={`${r.goal.dailyCustomers.toFixed(1)} per day`}
                />
                <MiniStat
                  label="Ad spend / month"
                  value={fmt(r.goal.monthlyAdSpend)}
                  color="var(--amber)"
                  hint={`${fmt(r.goal.dailyAdSpend)} per day`}
                />
                <MiniStat
                  label="Clicks / month"
                  value={r.goal.clicksNeeded ? Math.ceil(r.goal.clicksNeeded).toLocaleString() : "—"}
                  color="var(--cyan)"
                  hint={r.goal.dailyClicks ? `${Math.ceil(r.goal.dailyClicks).toLocaleString()} per day` : ""}
                />
                <MiniStat
                  label="Total revenue / mo"
                  value={fmt(r.goal.totalRevenue)}
                  color="var(--violet)"
                  hint="front + backend"
                />
              </div>

              {/* Breakdown table */}
              <div style={{ background: "var(--bg-elev-2)", borderRadius: 12, padding: "4px 14px", border: "1px solid var(--border)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "12px 8px", color: "var(--text-faint)", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                        Profit per customer (lifetime)
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--green)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>
                        {fmt(r.goal.profitPerCust)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "12px 8px", color: "var(--text-faint)", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                        CPA used
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--amber)", borderBottom: "1px solid var(--border)" }}>
                        {fmt(r.goal.cpa)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "12px 8px", color: "var(--text-faint)", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                        CVR used
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--cyan)", borderBottom: "1px solid var(--border)" }}>
                        {r.goal.cvr.toFixed(2)}%
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "12px 8px", color: "var(--text-faint)", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                        Front-end revenue / month
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--text)", borderBottom: "1px solid var(--border)" }}>
                        {fmt(r.goal.feRevenue)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "12px 8px", color: "var(--text-faint)", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
                        Backend revenue / month
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--text)", borderBottom: "1px solid var(--border)" }}>
                        {fmt(r.goal.beRevenue)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "14px 8px", color: "var(--green)", fontWeight: 600, fontSize: 12, background: "rgba(34, 197, 94, 0.04)" }}>
                        Net profit / month
                      </td>
                      <td style={{ padding: "14px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--green)", fontWeight: 700, fontSize: 15, background: "rgba(34, 197, 94, 0.04)" }}>
                        {fmt(r.goal.goalProfit)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--text-dim)" }}>Assumptions:</strong> steady-state monthly cohort, customers acquired in a month go through their full rebill cycle. Actual cashflow in early months will be lower because backend takes time to materialize.
              </div>
            </>
          )}
        </div>

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
                const isYours = Math.abs(s.cushionTarget - calculatedInputs.frontCushion) < 0.5;
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
              {/* Custom price row */}
              <tr style={{
                background: "rgba(34, 197, 94, 0.05)",
                borderTop: "2px solid rgba(34, 197, 94, 0.25)",
              }}>
                <td style={{ padding: "14px 8px", borderBottom: "none" }}>
                  <span style={{ color: "var(--green)", fontWeight: 600, fontSize: 12 }}>
                    ✎ Your custom price
                  </span>
                </td>
                <td style={{ padding: "8px", borderBottom: "none", textAlign: "right" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", background: "var(--bg-elev-2)", borderRadius: 8, border: "1px solid var(--border-strong)", maxWidth: 110 }}>
                    <span style={{ paddingLeft: 8, color: "var(--green)", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600 }}>$</span>
                    <input
                      type="number"
                      value={inputs.customPrice || ""}
                      placeholder="0.00"
                      onChange={(e) => u("customPrice", parseFloat(e.target.value) || 0)}
                      step="0.01"
                      style={{
                        width: 70,
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        color: "var(--text)",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "8px",
                        textAlign: "right",
                      }}
                    />
                  </div>
                </td>
                {r.custom ? (
                  <>
                    <td style={{ padding: "14px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: r.custom.frontEndGross >= 0 ? "var(--green)" : "var(--red)", borderBottom: "none" }}>
                      {fmt(r.custom.frontEndGross)}
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--violet)", borderBottom: "none" }}>
                      {fmt(r.backendNet)}
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--cyan)", fontWeight: 600, borderBottom: "none" }}>
                      {fmtX(r.custom.beROAS)}
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "var(--amber)", borderBottom: "none" }}>
                      {fmt(r.custom.maxCPC_total)}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} style={{ padding: "14px 8px", textAlign: "center", color: "var(--text-faint)", fontSize: 11, borderBottom: "none", fontStyle: "italic" }}>
                    Type your price → click <strong style={{ color: "var(--green)" }}>Calculate</strong>
                  </td>
                )}
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)" }}>
            Pick your strategy by changing the <strong style={{ color: "var(--text-dim)" }}>Front-end cushion</strong> input above, or type your own price in the custom row.
          </div>
        </div>

        {/* ========== ROAS SCENARIOS ========== */}

        <div className="card">
          <SectionHeader accent="var(--amber)">
            Profit at different ROAS levels
            <span style={{ color: "var(--text-faint)", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
              (at {fmt(r.active.price)})
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
                const isBE = Math.abs(row.roas - r.active.beROAS) < 0.15;
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
