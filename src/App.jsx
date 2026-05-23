import { useState, useMemo, useEffect } from "react";

const FACTORY_DEFAULTS = {
  cogs: 37.56,
  rebillPrice: 29.99,
  rebillCycles: 3,
  stickRate: 70,
  chargebackRate: 10,
  refundRate: 10,
  txFeeRate: 7.8,
  cbFee: 25,
  preAlertRate: 3,
  preAlertFee: 20,
};

const STORAGE_KEY = "roas-calc-defaults-v1";

function loadDefaults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return FACTORY_DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...FACTORY_DEFAULTS, ...parsed };
  } catch {
    return FACTORY_DEFAULTS;
  }
}

function calc(inputs) {
  const { cogs, rebillPrice, rebillCycles, stickRate, chargebackRate, refundRate, txFeeRate, cbFee, preAlertRate, preAlertFee } = inputs;
  const stick = stickRate / 100;
  const cbR = chargebackRate / 100;
  const refR = refundRate / 100;
  const txR = txFeeRate / 100;
  const paR = preAlertRate / 100;

  let rebillNet = 0;
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
    rebillNet += net;
    rebillDetails.push({ cycle: i + 1, customers: active, rev, net });
  }

  const minPrice = cogs / (1 - txR);
  const suggestedPrice = Math.ceil(((cogs + 5) / (1 - txR)) * 100) / 100;
  const comfortPrice = Math.ceil(((cogs + 10) / (1 - txR)) * 100) / 100;
  const toNineNine = (p) => Math.floor(p) + 0.99;
  const priceLow = toNineNine(suggestedPrice);
  const priceHigh = toNineNine(comfortPrice);

  const calcForPrice = (price) => {
    const frontNet = price - cogs - price * txR;
    const totalNet = frontNet + rebillNet;
    const beRoas = totalNet > 0 ? price / totalNet : Infinity;
    return { price, frontNet, totalNet, beRoas };
  };
  const low = calcForPrice(priceLow);
  const high = calcForPrice(priceHigh);
  const recommended = low.beRoas <= 1.5 ? low : high;

  const roasTable = [0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0].map((roas) => {
    const adSpend = recommended.price / roas;
    const profit = recommended.totalNet - adSpend;
    return { roas, adSpend, profit };
  });

  return { minPrice, priceLow: low, priceHigh: high, recommended, rebillNet, rebillDetails, roasTable };
}

function Field({ label, value, onChange, prefix, suffix, step = "1" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-faint)",
        }}
      >
        {label}
      </label>
      <div className="input-wrap">
        {prefix && (
          <span
            style={{
              paddingLeft: 12,
              color: "var(--green)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          step={step}
          className="number-input"
        />
        {suffix && (
          <span
            style={{
              paddingRight: 12,
              color: "var(--text-faint)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13,
            }}
          >
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ accent, children, right }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 4,
            height: 14,
            borderRadius: 2,
            background: accent,
          }}
        />
        <h2
          style={{
            fontSize: 13,
            fontWeight: 600,
            margin: 0,
            color: "var(--text)",
            letterSpacing: "-0.005em",
          }}
        >
          {children}
        </h2>
      </div>
      {right}
    </div>
  );
}

export default function App() {
  const [inputs, setInputs] = useState(loadDefaults);
  const [toast, setToast] = useState(null);
  const r = useMemo(() => calc(inputs), [inputs]);

  const u = (k, v) => setInputs((p) => ({ ...p, [k]: v }));
  const fmt = (n) => "$" + n.toFixed(2);

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

  const resetToSaved = () => {
    setInputs(loadDefaults());
    showToast("↻ Reset to saved defaults");
  };

  const resetToFactory = () => {
    setInputs(FACTORY_DEFAULTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    showToast("↺ Reset to factory defaults");
  };

  const hasSavedDefaults = (() => {
    try {
      return !!localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
  })();

  return (
    <div style={{ minHeight: "100vh", padding: "40px 20px 60px" }}>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        {/* Header */}
        <header style={{ marginBottom: 32 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
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
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "var(--green)", boxShadow: "0 0 8px var(--green)",
                }} />
                Live calculator
              </div>
              <h1
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  margin: 0,
                  letterSpacing: "-0.025em",
                  background: "linear-gradient(180deg, #fff 0%, #aaa 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Price & BE ROAS
              </h1>
              <p style={{ color: "var(--text-dim)", fontSize: 14, margin: "4px 0 0" }}>
                Enter your costs → get your price + breakeven ROAS
              </p>
            </div>
          </div>
        </header>

        {/* Defaults toolbar */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 16,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
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
          <button className="btn btn-ghost" onClick={resetToFactory}>
            Reset to factory
          </button>
          {hasSavedDefaults && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "var(--text-faint)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              ● Custom defaults loaded
            </span>
          )}
        </div>

        {/* Inputs */}
        <div className="card">
          <SectionHeader accent="var(--green)">Your numbers</SectionHeader>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
            }}
          >
            <Field label="Product cost (COGS)" value={inputs.cogs} onChange={(v) => u("cogs", v)} prefix="$" step="0.01" />
            <Field label="Rebill price" value={inputs.rebillPrice} onChange={(v) => u("rebillPrice", v)} prefix="$" step="0.01" />
            <Field label="Rebill cycles" value={inputs.rebillCycles} onChange={(v) => u("rebillCycles", v)} step="1" />
            <Field label="Stick rate" value={inputs.stickRate} onChange={(v) => u("stickRate", v)} suffix="%" />
            <Field label="Chargeback rate" value={inputs.chargebackRate} onChange={(v) => u("chargebackRate", v)} suffix="%" step="0.5" />
            <Field label="Refund rate" value={inputs.refundRate} onChange={(v) => u("refundRate", v)} suffix="%" step="0.5" />
            <Field label="Transaction fee" value={inputs.txFeeRate} onChange={(v) => u("txFeeRate", v)} suffix="%" step="0.1" />
            <Field label="Chargeback fee" value={inputs.cbFee} onChange={(v) => u("cbFee", v)} prefix="$" step="1" />
            <Field label="Pre-alert rate" value={inputs.preAlertRate} onChange={(v) => u("preAlertRate", v)} suffix="%" step="0.5" />
            <Field label="Pre-alert fee" value={inputs.preAlertFee} onChange={(v) => u("preAlertFee", v)} prefix="$" step="1" />
          </div>
        </div>

        {/* Results hero */}
        <div
          style={{
            position: "relative",
            background:
              "radial-gradient(ellipse at top left, var(--green-glow), transparent 60%), radial-gradient(ellipse at bottom right, var(--cyan-glow), transparent 60%), var(--bg-elev)",
            borderRadius: 20,
            padding: 32,
            border: "1px solid var(--border)",
            marginBottom: 16,
            overflow: "hidden",
          }}
        >
          <SectionHeader accent="var(--green)">Your results</SectionHeader>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 20,
            }}
          >
            <ResultTile
              label="List your product at"
              value={fmt(r.recommended.price)}
              color="var(--green)"
              glow="var(--green-glow)"
            />
            <ResultTile
              label="Your BE ROAS"
              value={r.recommended.beRoas === Infinity ? "∞" : r.recommended.beRoas.toFixed(2) + "x"}
              color="var(--cyan)"
              glow="var(--cyan-glow)"
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              fontSize: 13,
            }}
          >
            <MiniStat
              label="Total net / customer"
              value={fmt(r.recommended.totalNet)}
              color="var(--text)"
              hint={`over ${inputs.rebillCycles} rebill cycles`}
            />
            <MiniStat
              label="Front-end margin"
              value={fmt(r.recommended.frontNet)}
              color={r.recommended.frontNet >= 0 ? "var(--green)" : "var(--red)"}
              hint="per initial sale"
            />
            <MiniStat
              label="Rebill profit"
              value={fmt(r.rebillNet)}
              color="var(--cyan)"
              hint="cumulative"
            />
          </div>
        </div>

        {/* Price options */}
        <div className="card">
          <SectionHeader accent="var(--violet)">Price options</SectionHeader>
          <DataTable
            headers={["Price", "Front-end", "Net / cust", "BE ROAS"]}
            rows={[r.priceLow, r.priceHigh].map((p) => ({
              highlighted: p.price === r.recommended.price,
              cells: [
                { value: fmt(p.price) + (p.price === r.recommended.price ? "  ←" : ""), bold: true },
                { value: fmt(p.frontNet), color: p.frontNet >= 0 ? "var(--green)" : "var(--red)" },
                { value: fmt(p.totalNet), color: "var(--cyan)" },
                { value: p.beRoas.toFixed(2) + "x", color: "var(--amber)", bold: true },
              ],
            }))}
          />
        </div>

        {/* ROAS profit table */}
        <div className="card">
          <SectionHeader accent="var(--amber)">
            Profit at different ROAS levels
            <span style={{ color: "var(--text-faint)", fontWeight: 400, marginLeft: 6 }}>
              (at {fmt(r.recommended.price)})
            </span>
          </SectionHeader>
          <DataTable
            headers={["ROAS", "Ad spend / cust", "Profit / cust", ""]}
            rows={r.roasTable.map((row) => ({
              cells: [
                { value: row.roas.toFixed(1) + "x" },
                { value: fmt(row.adSpend), color: "var(--amber)" },
                {
                  value: (row.profit >= 0 ? "+" : "") + fmt(row.profit),
                  color: row.profit >= 0 ? "var(--green)" : "var(--red)",
                  bold: true,
                },
                {
                  value:
                    row.profit > 15
                      ? "● Healthy"
                      : row.profit > 0
                      ? "● Marginal"
                      : "● Bleeding",
                  color:
                    row.profit > 15
                      ? "var(--green)"
                      : row.profit > 0
                      ? "var(--amber)"
                      : "var(--red)",
                  align: "left",
                  small: true,
                },
              ],
            }))}
          />
        </div>

        <div
          style={{
            textAlign: "center",
            color: "var(--text-faint)",
            fontSize: 11,
            padding: "16px 0",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Rebill schedule: Day 20 / 50 / 80 · All fees & losses included
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ResultTile({ label, value, color, glow }) {
  return (
    <div
      style={{
        background: "var(--bg-elev-2)",
        borderRadius: 14,
        padding: "20px 22px",
        border: `1px solid ${color}33`,
        boxShadow: `0 0 0 1px ${color}10, 0 0 30px ${glow}`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: color,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 40,
          fontWeight: 700,
          color: color,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          fontFamily: "'Inter', sans-serif",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color, hint }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: "var(--text-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: color,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function DataTable({ headers, rows }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 13,
      }}
    >
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={i}
              style={{
                textAlign: i === headers.length - 1 && h === "" ? "left" : i === 0 ? "left" : "right",
                padding: "8px 8px",
                color: "var(--text-faint)",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={i}
            style={{
              background: row.highlighted ? "rgba(34, 197, 94, 0.04)" : "transparent",
            }}
          >
            {row.cells.map((c, j) => (
              <td
                key={j}
                style={{
                  padding: "12px 8px",
                  textAlign: c.align || (j === 0 ? "left" : j === row.cells.length - 1 && headers[j] === "" ? "left" : "right"),
                  color: c.color || "var(--text)",
                  fontWeight: c.bold ? 600 : 400,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: c.small ? 11 : 13,
                  borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                {c.value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
