import { useState, useMemo } from "react";

function calc(inputs) {
  const { cogs, rebillPrice, rebillCycles, stickRate, chargebackRate, refundRate, txFeeRate, cbFee, preAlertRate, preAlertFee } = inputs;
  const stick = stickRate / 100;
  const cbR = chargebackRate / 100;
  const refR = refundRate / 100;
  const txR = txFeeRate / 100;
  const paR = preAlertRate / 100;
  // Calculate total rebill net per customer
  let rebillNet = 0;
  let active = 1;
  let rebillDetails = [];
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
  // Suggested price: COGS + enough margin to not bleed on front end
  // Price where front-end net = ~$5-8 cushion
  // frontNet = price - cogs - (price * txR) = price(1 - txR) - cogs
  // For small cushion: price(1-txR) = cogs + 5 => price = (cogs+5)/(1-txR)
  const minPrice = cogs / (1 - txR); // absolute minimum (zero margin)
  const suggestedPrice = Math.ceil(((cogs + 5) / (1 - txR)) * 100) / 100; // ~$5 cushion
  const comfortPrice = Math.ceil(((cogs + 10) / (1 - txR)) * 100) / 100; // ~$10 cushion
  // Round to .99
  const toNineNine = (p) => Math.floor(p) + 0.99;
  const priceLow = toNineNine(suggestedPrice);
  const priceHigh = toNineNine(comfortPrice);
  // Calculate BE ROAS for each price
  const calcForPrice = (price) => {
    const frontNet = price - cogs - (price * txR);
    const totalNet = frontNet + rebillNet;
    const beRoas = totalNet > 0 ? price / totalNet : Infinity;
    return { price, frontNet, totalNet, beRoas };
  };
  const low = calcForPrice(priceLow);
  const high = calcForPrice(priceHigh);
  // ROAS profit table for recommended price
  const recommended = low.beRoas <= 1.5 ? low : high;
  const roasTable = [0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0].map(roas => {
    const adSpend = recommended.price / roas;
    const profit = recommended.totalNet - adSpend;
    return { roas, adSpend, profit };
  });
  return {
    minPrice,
    priceLow: low,
    priceHigh: high,
    recommended,
    rebillNet,
    rebillDetails,
    roasTable,
  };
}

function Input({ label, value, onChange, prefix, suffix, step = "1" }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: "block", fontSize: 10, fontFamily: "mono", textTransform: "uppercase",
        letterSpacing: "0.1em", color: "#777", marginBottom: 5,
      }}>{label}</label>
      <div style={{
        display: "flex", alignItems: "center", background: "#141418",
        borderRadius: 8, border: "1px solid #2a2a30", overflow: "hidden",
      }}>
        {prefix && <span style={{ padding: "9px 0 9px 10px", color: "#4ade80", fontFamily: "mono", fontSize: 14, fontWeight: 700 }}>{prefix}</span>}
        <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
          step={step} style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "#eee", padding: "9px 10px", fontSize: 14, fontFamily: "mono", width: "100%",
          }} />
        {suffix && <span style={{ padding: "9px 10px 9px 0", color: "#777", fontFamily: "mono", fontSize: 12 }}>{suffix}</span>}
      </div>
    </div>
  );
}

export default function App() {
  const [inputs, setInputs] = useState({
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
  });
  const u = (k, v) => setInputs(p => ({ ...p, [k]: v }));
  const r = useMemo(() => calc(inputs), [inputs]);
  const $ = n => "$" + n.toFixed(2);

  const boxStyle = {
    background: "#111115", borderRadius: 14, padding: 22,
    border: "1px solid #222228", marginBottom: 20,
  };
  const headStyle = {
    fontSize: 11, fontFamily: "mono", textTransform: "uppercase",
    letterSpacing: "0.1em", fontWeight: 600, marginBottom: 14,
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0e", color: "#ddd",
      fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "28px 16px",
    }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Title */}
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px", color: "#fff" }}>
            Price & BE ROAS Calculator
          </h1>
          <p style={{ color: "#666", fontSize: 12, fontFamily: "mono", margin: 0 }}>
            Enter your costs → get your price + breakeven ROAS
          </p>
        </div>

        {/* Inputs */}
        <div style={boxStyle}>
          <div style={{ ...headStyle, color: "#4ade80" }}>Your Numbers</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
            <Input label="Product cost (COGS)" value={inputs.cogs} onChange={v => u("cogs", v)} prefix="$" step="0.01" />
            <Input label="Rebill price" value={inputs.rebillPrice} onChange={v => u("rebillPrice", v)} prefix="$" step="0.01" />
            <Input label="Rebill cycles" value={inputs.rebillCycles} onChange={v => u("rebillCycles", v)} step="1" />
            <Input label="Stick rate" value={inputs.stickRate} onChange={v => u("stickRate", v)} suffix="%" />
            <Input label="Chargeback rate" value={inputs.chargebackRate} onChange={v => u("chargebackRate", v)} suffix="%" step="0.5" />
            <Input label="Refund rate" value={inputs.refundRate} onChange={v => u("refundRate", v)} suffix="%" step="0.5" />
            <Input label="Transaction fee" value={inputs.txFeeRate} onChange={v => u("txFeeRate", v)} suffix="%" step="0.1" />
            <Input label="Chargeback fee" value={inputs.cbFee} onChange={v => u("cbFee", v)} prefix="$" step="1" />
            <Input label="Pre-alert rate" value={inputs.preAlertRate} onChange={v => u("preAlertRate", v)} suffix="%" step="0.5" />
            <Input label="Pre-alert fee" value={inputs.preAlertFee} onChange={v => u("preAlertFee", v)} prefix="$" step="1" />
          </div>
        </div>

        {/* THE ANSWER */}
        <div style={{
          background: "linear-gradient(135deg, #0f2a1a 0%, #111115 50%, #0f1a2a 100%)",
          borderRadius: 14, padding: 28, border: "1px solid #1a3a25",
          marginBottom: 20, textAlign: "center",
        }}>
          <div style={{ ...headStyle, color: "#4ade80", marginBottom: 20 }}>
            ✅ Your Results
          </div>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
            <div style={{
              background: "#0d0d12", borderRadius: 12, padding: "18px 28px",
              border: "2px solid #4ade80", minWidth: 180,
            }}>
              <div style={{ fontSize: 10, fontFamily: "mono", color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                List your product at
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, color: "#4ade80" }}>
                {$(r.recommended.price)}
              </div>
            </div>
            <div style={{
              background: "#0d0d12", borderRadius: 12, padding: "18px 28px",
              border: "2px solid #22d3ee", minWidth: 180,
            }}>
              <div style={{ fontSize: 10, fontFamily: "mono", color: "#22d3ee", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                Your BE ROAS
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, color: "#22d3ee" }}>
                {r.recommended.beRoas === Infinity ? "∞" : r.recommended.beRoas.toFixed(2) + "x"}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
            At {$(r.recommended.price)}, each customer nets you <span style={{ color: "#4ade80", fontWeight: 700 }}>{$(r.recommended.totalNet)}</span> over {inputs.rebillCycles} rebill cycles.
            <br />
            Front-end margin: <span style={{ color: r.recommended.frontNet >= 0 ? "#4ade80" : "#ef4444", fontWeight: 600 }}>{$(r.recommended.frontNet)}</span> per sale.
            Rebill profit: <span style={{ color: "#22d3ee", fontWeight: 600 }}>{$(r.rebillNet)}</span> per customer.
          </div>
        </div>

        {/* Alternative price */}
        <div style={boxStyle}>
          <div style={{ ...headStyle, color: "#a78bfa" }}>Price Options</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "mono" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #222" }}>
                {["Price", "Front-end profit", "Total net/cust", "BE ROAS"].map(h => (
                  <th key={h} style={{ textAlign: "right", padding: "8px 6px", color: "#666", fontSize: 10, textTransform: "uppercase", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[r.priceLow, r.priceHigh].map((p, i) => (
                <tr key={i} style={{
                  borderBottom: "1px solid #1a1a1e",
                  background: p.price === r.recommended.price ? "rgba(74,222,128,0.06)" : "transparent",
                }}>
                  <td style={{ padding: "10px 6px", textAlign: "right", color: "#fff", fontWeight: 700 }}>
                    {$(p.price)} {p.price === r.recommended.price ? " ←" : ""}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "right", color: p.frontNet >= 0 ? "#4ade80" : "#ef4444" }}>{$(p.frontNet)}</td>
                  <td style={{ padding: "10px 6px", textAlign: "right", color: "#22d3ee" }}>{$(p.totalNet)}</td>
                  <td style={{ padding: "10px 6px", textAlign: "right", color: "#f59e0b", fontWeight: 600 }}>{p.beRoas.toFixed(2)}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ROAS profit table */}
        <div style={boxStyle}>
          <div style={{ ...headStyle, color: "#f59e0b" }}>
            Profit at different ROAS levels (at {$(r.recommended.price)})
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "mono" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #222" }}>
                {["ROAS", "Ad spend/cust", "Profit/cust", ""].map(h => (
                  <th key={h} style={{ textAlign: h === "" ? "left" : "right", padding: "8px 6px", color: "#666", fontSize: 10, textTransform: "uppercase", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.roasTable.map(row => (
                <tr key={row.roas} style={{ borderBottom: "1px solid #1a1a1e" }}>
                  <td style={{ padding: "10px 6px", textAlign: "right", color: "#ddd" }}>{row.roas.toFixed(1)}x</td>
                  <td style={{ padding: "10px 6px", textAlign: "right", color: "#f59e0b" }}>{$(row.adSpend)}</td>
                  <td style={{ padding: "10px 6px", textAlign: "right", color: row.profit >= 0 ? "#4ade80" : "#ef4444", fontWeight: 600 }}>
                    {row.profit >= 0 ? "+" : ""}{$(row.profit)}
                  </td>
                  <td style={{ padding: "10px 6px", fontSize: 11, color: row.profit > 15 ? "#4ade80" : row.profit > 0 ? "#f59e0b" : "#ef4444" }}>
                    {row.profit > 15 ? "🟢" : row.profit > 0 ? "🟡" : "🔴"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ textAlign: "center", color: "#333", fontSize: 10, fontFamily: "mono", padding: "10px 0 30px" }}>
          Rebill schedule: Day 20 / 50 / 80 • All fees & losses included
        </div>
      </div>
    </div>
  );
}
