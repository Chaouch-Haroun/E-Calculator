// E-Calculator core: the same profit model as the website (cash on delivery, Tunisia, amounts in TND).
// Used by the MCP server (server.mjs). Pure functions, no dependencies.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);

// ---------------------------------------------------------------- input helpers
function numArg(args, key, { required = false, def = 0, max = Infinity } = {}) {
  let v = args[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`"${key}" is required`);
    return def;
  }
  if (typeof v === "string") v = Number(v.replace(/\s/g, "").replace(",", "."));
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`"${key}" must be a number`);
  if (v < 0) throw new Error(`"${key}" cannot be negative`);
  return Math.min(v, max);
}
const boolArg = (args, key, def) => (args[key] === undefined ? def : args[key] === true || args[key] === "true");

// Product and cost settings shared by all tools → the page's state object
export function settingsFrom(args) {
  const cur = String(args.ad_currency || "USD").toUpperCase();
  if (!["USD", "TND"].includes(cur)) throw new Error('"ad_currency" must be "USD" or "TND"');
  return {
    price: numArg(args, "price", { required: true }),
    cost: numArg(args, "product_cost", { required: true }),
    pack: numArg(args, "packaging"),
    ship: numArg(args, "delivery_fee"),
    ret: numArg(args, "return_fee"),
    clientPays: boolArg(args, "customer_pays_delivery", false),
    cur: cur === "USD" ? "usd" : "dt",
    rate: numArg(args, "usd_to_tnd", { def: 3.1 }),
    wht: boolArg(args, "withholding_3pct", true),
    fixed: numArg(args, "fixed_costs"),
  };
}

// ---------------------------------------------------------------- the model (identical to compute() in index.html)
export function compute(s) {
  const leads = Math.max(0, s.leads);
  const confirmed = clamp(s.confN, 0, leads), confRate = leads > 0 ? confirmed / leads * 100 : 0;
  const delivered = clamp(s.delivN, 0, confirmed), returned = confirmed - delivered;
  const delivRate = confirmed > 0 ? delivered / confirmed * 100 : 0;
  const collectedPer = s.price + (s.clientPays ? s.ship : 0);
  const revenue = delivered * s.price;
  const product = delivered * s.cost;
  const packaging = confirmed * s.pack;
  const shipping = s.clientPays ? 0 : delivered * s.ship;
  const returns = returned * s.ret;
  const wht = s.wht ? 0.03 * delivered * collectedPer : 0;
  const ads = s.cur === "usd" ? s.ads * s.rate : s.ads;
  const fixed = s.fixed;
  const beforeAds = revenue - product - packaging - shipping - returns - wht - fixed;
  const profit = beforeAds - ads;
  const per = (v) => (delivered > 0 ? v / delivered : 0);
  const unitMargin = s.price - s.cost;
  const grossPct = s.price > 0 ? unitMargin / s.price * 100 : 0;
  const cpaDelivered = per(ads), cpl = leads > 0 ? ads / leads : 0;
  const maxCpa = per(beforeAds), maxCpl = leads > 0 ? beforeAds / leads : 0;
  const roas = ads > 0 ? revenue / ads : Infinity;
  const pFactor = delivered * (1 - (s.wht ? 0.03 : 0));
  const otherCosts = product + packaging + shipping + returns + (s.wht && s.clientPays ? 0.03 * delivered * s.ship : 0) + fixed + ads;
  const minPrice = pFactor > 0 ? otherCosts / pFactor : 0;
  return { leads, confirmed, confRate, delivered, returned, delivRate, revenue, product, packaging, shipping, returns, wht, ads, fixed, beforeAds, profit,
    perProfit: per(profit), unitMargin, grossPct, cpaDelivered, cpl, maxCpa, maxCpl, roas, minPrice, netPct: revenue > 0 ? profit / revenue * 100 : 0 };
}

// benchmarks used for the colours on the website (indicative, cash on delivery in Tunisia)
export const grade = {
  gross: (v) => (v >= 55 ? "good" : v >= 40 ? "warn" : "bad"),
  conf: (v) => (v >= 70 ? "good" : v >= 50 ? "warn" : "bad"),
  deliv: (v) => (v >= 80 ? "good" : v >= 65 ? "warn" : "bad"),
  cpa: (cpa, max) => (max <= 0 ? "bad" : cpa <= 0.6 * max ? "good" : cpa <= max ? "warn" : "bad"),
  roas: (v) => (v >= 4 ? "good" : v >= 2.5 ? "warn" : "bad"),
  net: (p, pct) => (p <= 0 ? "bad" : pct >= 15 ? "good" : "warn"),
};
const BENCH = {
  gross_margin_pct: "good ≥ 55, ok 40–55, weak < 40",
  confirmation_rate_pct: "good ≥ 70, ok 50–70, weak < 50",
  delivery_rate_pct: "good ≥ 80, ok 65–80, weak < 65",
  cost_per_delivered: "good ≤ 60% of the max, ok up to the max, loss above it",
  roas: "good ≥ 4, ok 2.5–4, weak < 2.5",
  net_profit: "good when net margin ≥ 15% of revenue",
};

// ---------------------------------------------------------------- tool: calculate_profit
function periodState(args) {
  return { ...settingsFrom(args),
    leads: numArg(args, "orders_received", { required: true }),
    confN: numArg(args, "orders_confirmed", { required: true }),
    delivN: numArg(args, "parcels_delivered", { required: true }),
    ads: numArg(args, "ad_spend") };
}
export function calculateProfit(args) {
  const s = periodState(args), r = compute(s), warnings = [];
  if (s.confN > s.leads) warnings.push("orders_confirmed is higher than orders_received; it was capped.");
  if (s.delivN > Math.min(s.confN, s.leads)) warnings.push("parcels_delivered is higher than orders_confirmed; it was capped.");
  const g = grade.net(r.profit, r.netPct);
  const checks = [
    { metric: "gross_margin_pct", value: r1(r.grossPct), grade: grade.gross(r.grossPct), benchmark: BENCH.gross_margin_pct },
    { metric: "confirmation_rate_pct", value: r1(r.confRate), grade: grade.conf(r.confRate), benchmark: BENCH.confirmation_rate_pct },
    { metric: "delivery_rate_pct", value: r1(r.delivRate), grade: grade.deliv(r.delivRate), benchmark: BENCH.delivery_rate_pct },
  ];
  if (r.ads > 0) {
    checks.push({ metric: "cost_per_delivered", value: r2(r.cpaDelivered), grade: grade.cpa(r.cpaDelivered, r.maxCpa), benchmark: BENCH.cost_per_delivered });
    checks.push({ metric: "roas", value: r2(r.roas), grade: grade.roas(r.roas), benchmark: BENCH.roas });
  }
  const advice = [];
  const gm = grade.gross(r.grossPct);
  advice.push(gm === "bad" ? `Product margin is ${r1(r.grossPct)}%. With cash on delivery and ads, aim for at least 50% (price about 2–3× the cost).`
    : gm === "warn" ? `Product margin of ${r1(r.grossPct)}% works only if confirmation and delivery are good; a bundle or a slightly higher price gives room.`
    : `Good product margin (${r1(r.grossPct)}%): there is room for ads and returns.`);
  if (grade.conf(r.confRate) !== "good") advice.push(`Confirmation at ${r1(r.confRate)}%: answer messages fast, call within the hour and state the full price including delivery.`);
  if (grade.deliv(r.delivRate) !== "good") advice.push(`Delivery at ${r1(r.delivRate)}%: ${r.returned} parcels come back. Call the customer the day before and avoid long delays.`);
  if (r.ads > 0) {
    const gp = grade.cpa(r.cpaDelivered, r.maxCpa);
    advice.push(gp === "bad" ? `Ads cost ${r2(r.cpaDelivered)} TND per delivered order, above the ${r2(Math.max(0, r.maxCpa))} TND limit: change the video (the hook) before adding budget.`
      : gp === "warn" ? `Ads at ${r2(r.cpaDelivered)} TND per delivered order for a ${r2(Math.max(0, r.maxCpa))} TND limit: profitable but tight; test 2–3 new videos.`
      : `Efficient ads: ${r2(r.cpaDelivered)} TND per delivered order, well under the ${r2(Math.max(0, r.maxCpa))} TND limit; budget can rise slowly (20–30% every 2–3 days).`);
  }
  if (s.wht && r.wht > 0) advice.push(`The 3% withholding costs ${r2(r.wht)} TND this period; with a tax ID (matricule fiscal) the courier no longer takes it.`);
  if (s.price < r.minPrice) advice.push(`The price (${s.price} TND) is below the minimum price (${r2(r.minPrice)} TND) for these numbers.`);
  return {
    currency: "TND",
    verdict: g === "good" ? "profitable" : g === "warn" ? "tight" : "losing",
    net_profit: r2(r.profit), profit_per_delivered_order: r2(r.perProfit), net_margin_pct: r1(r.netPct), revenue: r2(r.revenue),
    costs: { product: r2(r.product), packaging: r2(r.packaging), delivery: r2(r.shipping), returns: r2(r.returns), withholding_3pct: r2(r.wht), ads: r2(r.ads), fixed: r2(r.fixed) },
    funnel: { orders_received: r.leads, orders_confirmed: r.confirmed, parcels_delivered: r.delivered, parcels_returned: r.returned,
      confirmation_rate_pct: r1(r.confRate), delivery_rate_pct: r1(r.delivRate) },
    unit: { unit_margin: r2(r.unitMargin), gross_margin_pct: r1(r.grossPct) },
    limits: { max_ad_cost_per_delivered_order: r2(Math.max(0, r.maxCpa)), max_ad_cost_per_order_received: r2(Math.max(0, r.maxCpl)),
      ad_cost_per_delivered_order: r2(r.cpaDelivered), roas: Number.isFinite(r.roas) ? r2(r.roas) : null, minimum_price: r2(r.minPrice) },
    checks, advice, warnings,
    model: "Cash on delivery: product cost on delivered parcels, packaging on confirmed parcels, delivery fee on delivered parcels (unless the customer pays it), return fee on returned parcels (confirmed − delivered), 3% withholding on the amount collected.",
  };
}

// ---------------------------------------------------------------- tool: profit_sensitivity
const SENS = {
  delivery_rate: { unit: "%", get: (s) => compute(s).delivRate, set: (s, v) => ({ ...s, delivN: compute(s).confirmed * v / 100 }), range: () => [30, 100] },
  confirmation_rate: { unit: "%", get: (s) => compute(s).confRate,
    set: (s, v) => { const r = compute(s).delivRate; return { ...s, confN: s.leads * v / 100, delivN: s.leads * v / 100 * r / 100 }; }, range: () => [20, 100] },
  ad_spend: { unit: "ad currency", get: (s) => s.ads, set: (s, v) => ({ ...s, ads: v }), range: (s) => [0, Math.max(1, s.ads * 2.5)] },
  price: { unit: "TND", get: (s) => s.price, set: (s, v) => ({ ...s, price: v }), range: (s) => [Math.max(0, s.price * 0.5), Math.max(1, s.price * 1.6)] },
};
export function profitSensitivity(args) {
  const s = periodState(args), name = args.variable;
  const d = SENS[name];
  if (!d) throw new Error(`"variable" must be one of: ${Object.keys(SENS).join(", ")}`);
  let [from, to] = d.range(s);
  if (args.from !== undefined) from = numArg(args, "from");
  if (args.to !== undefined) to = numArg(args, "to");
  if (to <= from) throw new Error('"to" must be greater than "from"');
  const steps = Math.round(numArg(args, "steps", { def: 10, max: 100 })) || 10;
  const points = [];
  for (let i = 0; i <= steps; i++) { const v = from + (to - from) * i / steps; points.push({ value: r2(v), net_profit: r2(compute(d.set(s, v)).profit) }); }
  let breakEven = null;
  for (let i = 0; i <= 400; i++) {   // fine scan for the break-even point
    const a = from + (to - from) * i / 400, b = from + (to - from) * (i + 1) / 400;
    const pa = compute(d.set(s, a)).profit, pb = compute(d.set(s, b)).profit;
    if ((pa < 0) !== (pb < 0)) { breakEven = r2(a + (b - a) * (-pa) / (pb - pa)); break; }
  }
  return { currency: "TND", variable: name, unit: d.unit, current_value: r2(d.get(s)), current_net_profit: r2(compute(s).profit), break_even_value: breakEven, points };
}

// ---------------------------------------------------------------- tool: daily_report
function dayMoney(s, e) {
  const collected = s.price + (s.clientPays ? s.ship : 0);
  const revenue = e.deliv * s.price, product = e.deliv * s.cost, packaging = e.conf * s.pack;
  const shipping = s.clientPays ? 0 : e.deliv * s.ship, returns = e.ret * s.ret;
  const wht = s.wht ? 0.03 * e.deliv * collected : 0, ads = s.cur === "usd" ? e.ads * s.rate : e.ads;
  return { revenue, product, packaging, shipping, returns, wht, ads, profit: revenue - product - packaging - shipping - returns - wht - ads };
}
export function dailyReport(args) {
  const s = settingsFrom(args);
  if (!Array.isArray(args.days) || !args.days.length) throw new Error('"days" must be a non-empty list');
  const days = args.days.map((d, i) => {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) throw new Error(`days[${i}].date must be YYYY-MM-DD`);
    const e = { leads: numArg(d, "orders_received"), conf: numArg(d, "orders_confirmed"), deliv: numArg(d, "parcels_delivered"),
      ret: numArg(d, "parcels_returned"), ads: numArg(d, "ad_spend") };
    const m = dayMoney(s, e);
    return { date: d.date, ...Object.fromEntries(Object.entries({ orders_received: e.leads, orders_confirmed: e.conf, parcels_delivered: e.deliv, parcels_returned: e.ret })),
      revenue: r2(m.revenue), ads_tnd: r2(m.ads), product_cost: r2(m.product), packaging: r2(m.packaging), delivery: r2(m.shipping),
      return_fees: r2(m.returns), withholding_3pct: r2(m.wht), profit: r2(m.profit), _p: m.profit, _e: e, _m: m };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const months = [...new Set(days.map((d) => d.date.slice(0, 7)))];
  const tot = { orders_received: 0, orders_confirmed: 0, parcels_delivered: 0, parcels_returned: 0, revenue: 0, ads_tnd: 0, profit_before_fixed: 0 };
  for (const d of days) { tot.orders_received += d._e.leads; tot.orders_confirmed += d._e.conf; tot.parcels_delivered += d._e.deliv; tot.parcels_returned += d._e.ret;
    tot.revenue += d._m.revenue; tot.ads_tnd += d._m.ads; tot.profit_before_fixed += d._p; }
  const fixedTotal = s.fixed * months.length;            // fixed_costs are per month
  const best = days.reduce((a, d) => (d._p > a._p ? d : a)), worst = days.reduce((a, d) => (d._p < a._p ? d : a));
  // projection to the end of the last month, at the pace since the first logged day of that month
  const last = months[months.length - 1], [y, m] = last.split("-").map(Number), nDays = new Date(y, m, 0).getDate();
  const inLast = days.filter((d) => d.date.startsWith(last));
  const firstDay = Number(inLast[0].date.slice(8)), asOf = args.as_of && /^\d{4}-\d{2}-\d{2}$/.test(args.as_of) && args.as_of.startsWith(last)
    ? Number(args.as_of.slice(8)) : Number(inLast[inLast.length - 1].date.slice(8));
  const span = Math.max(1, asOf - firstDay + 1), lastProfit = inLast.reduce((a, d) => a + d._p, 0);
  const projection = asOf < nDays ? r2(lastProfit / span * (nDays - firstDay + 1) - s.fixed) : null;
  return {
    currency: "TND", months,
    days: days.map(({ _p, _e, _m, ...d }) => d),
    totals: { ...Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, r2(v)])),
      confirmation_rate_pct: tot.orders_received ? r1(tot.orders_confirmed / tot.orders_received * 100) : null,
      delivery_rate_pct: tot.orders_confirmed ? r1(tot.parcels_delivered / tot.orders_confirmed * 100) : null,
      fixed_costs: r2(fixedTotal), net_profit: r2(tot.profit_before_fixed - fixedTotal),
      average_profit_per_logged_day: r2(tot.profit_before_fixed / days.length) },
    best_day: { date: best.date, profit: best.profit }, worst_day: { date: worst.date, profit: worst.profit },
    month_end_projection: projection == null ? null : { month: last, net_profit: projection, based_on_days: span },
  };
}

// ---------------------------------------------------------------- MCP tool definitions
const productProps = {
  price: { type: "number", description: "Selling price per piece, TND" },
  product_cost: { type: "number", description: "What the seller pays the supplier per piece, TND" },
  packaging: { type: "number", description: "Packaging per parcel sent (box, tape, label), TND. Default 0" },
  delivery_fee: { type: "number", description: "Courier fee per delivered parcel, TND. Default 0" },
  return_fee: { type: "number", description: "Courier fee per refused/returned parcel, TND. Default 0" },
  customer_pays_delivery: { type: "boolean", description: "True if the customer pays the delivery fee on top of the price. Default false" },
  ad_currency: { type: "string", enum: ["USD", "TND"], description: "Currency of ad_spend. Default USD (Meta ads are usually paid in dollars)" },
  usd_to_tnd: { type: "number", description: "Real exchange rate of the seller's card including fees. Default 3.1" },
  withholding_3pct: { type: "boolean", description: "True if the seller has no tax ID (matricule fiscal), so the courier withholds 3% of the amount collected. Default true" },
  fixed_costs: { type: "number", description: "Other costs for the period (or per month for daily_report), TND. Default 0" },
};
const periodProps = {
  orders_received: { type: "number", description: "Orders received in the period" },
  orders_confirmed: { type: "number", description: "Orders confirmed by phone (≤ orders_received)" },
  parcels_delivered: { type: "number", description: "Parcels delivered and paid (≤ orders_confirmed). Confirmed but not delivered parcels count as returns" },
  ad_spend: { type: "number", description: "Ad spend for the period, in ad_currency. Default 0" },
};
export const TOOLS = [
  {
    name: "calculate_profit",
    title: "Calculate e-commerce profit",
    description: "Real net profit for a cash-on-delivery e-commerce product in Tunisia over a period (week, month, test): revenue, every cost, confirmation and delivery rates, max ad cost per delivered order, minimum price, ROAS, graded checks against benchmarks and concrete advice. Amounts in TND.",
    inputSchema: { type: "object", properties: { ...productProps, ...periodProps }, required: ["price", "product_cost", "orders_received", "orders_confirmed", "parcels_delivered"] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "profit_sensitivity",
    title: "What-if: profit when one number changes",
    description: "Net profit as one variable changes (delivery_rate %, confirmation_rate %, ad_spend, or price), with the break-even value. Same inputs as calculate_profit plus the variable and an optional range.",
    inputSchema: { type: "object", properties: { ...productProps, ...periodProps,
      variable: { type: "string", enum: Object.keys(SENS), description: "What to vary" },
      from: { type: "number", description: "Start of the range (optional, a sensible default is used)" },
      to: { type: "number", description: "End of the range (optional)" },
      steps: { type: "number", description: "Number of steps, default 10, max 100" } },
      required: ["price", "product_cost", "orders_received", "orders_confirmed", "parcels_delivered", "variable"] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "daily_report",
    title: "Day-by-day profit report",
    description: "Profit of each logged day and the totals: orders, rates, revenue, ads, net profit after monthly fixed costs, best and worst day, and a month-end projection at the current pace. Use it when the seller gives numbers per day.",
    inputSchema: { type: "object", properties: { ...productProps,
      days: { type: "array", description: "One entry per day", items: { type: "object", properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        orders_received: { type: "number" }, orders_confirmed: { type: "number" },
        parcels_delivered: { type: "number", description: "Delivered and paid that day" },
        parcels_returned: { type: "number", description: "Returned that day" },
        ad_spend: { type: "number", description: "Ad spend that day, in ad_currency" } }, required: ["date"] } },
      as_of: { type: "string", description: "Today's date YYYY-MM-DD, for the month-end projection (optional)" } },
      required: ["price", "product_cost", "days"] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];
const HANDLERS = { calculate_profit: calculateProfit, profit_sensitivity: profitSensitivity, daily_report: dailyReport };
export function callTool(name, args) {
  const h = HANDLERS[name];
  if (!h) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  return h(args || {});
}
