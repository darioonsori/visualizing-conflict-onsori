/***************************************************************
 * Visualizing Conflict — comparison charts (OWID / UCDP)
 * Datasets: data/conflict_deaths_by_type.csv
 * Charts: (1) Top-10 bar  (2) Grouped bar  (3) Heatmap
 *         (4) 100% stacked bar  (5) Waffle
 * Notes:  - Country rows detected by ISO3 code; regional aggregates removed
 *         - Robust column detection by header substrings
 ***************************************************************/

const DATA_PATH = "data/conflict_deaths_by_type.csv";
const SNAPSHOT_YEAR = 2023;
const FOCUS_COUNTRIES = ["Ukraine", "Palestine", "Sudan", "Mexico", "Burkina Faso"];

// Color scale reused across charts (UCDP types)
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(["Interstate", "Intrastate", "Extrasystemic", "Non-state", "One-sided"])
  .range(["#6c8ae4", "#f28e2b", "#edc948", "#59a14f", "#e15759"]);

// One shared tooltip
const tip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

// Lightweight helper to print a visible alert inside a mount point
function alertIn(sel, msg) {
  const box = d3.select(sel);
  if (!box.empty()) {
    box.html("").append("div").attr("class", "alert").text(msg);
  }
}

// ISO3 guard
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

// Header detection tolerant to case/spacing
function detectColumns(headers) {
  const low = headers.map(h => h.toLowerCase());
  const find = kw => headers[low.findIndex(x => x.includes(kw))];

  return {
    entity:        find("entity")      || "Entity",
    code:          find("code")        || "Code",
    year:          find("year")        || "Year",
    interstate:    find("conflict type: interstate"),
    intrastate:    find("conflict type: intrastate"),
    extrasystemic: find("conflict type: extrasystemic"),
    nonstate:      find("conflict type: non-state"),
    onesided:      find("conflict type: one-sided")
  };
}

// Map raw CSV row -> normalized record
function mapRow(d, C) {
  const r = {
    entity: d[C.entity],
    code:   d[C.code],
    year:  +d[C.year],
    Interstate:    +d[C.interstate]    || 0,
    Intrastate:    +d[C.intrastate]    || 0,
    Extrasystemic: +d[C.extrasystemic] || 0,
    "Non-state":   +d[C.nonstate]      || 0,
    "One-sided":   +d[C.onesided]      || 0
  };
  r.total = r.Interstate + r.Intrastate + r.Extrasystemic + r["Non-state"] + r["One-sided"];
  return r;
}

/* ======================= LOAD CSV ======================= */

let worldOnly = [];  // kept global for the waffle call

d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw?.length) throw new Error("CSV appears empty.");

  const headers = Object.keys(raw[0]);
  const C = detectColumns(headers);

  const required = [C.entity, C.code, C.year, C.intrastate, C.nonstate, C.onesided];
  if (required.some(x => !x)) {
    alertIn("#bar-top10", "Missing expected columns in the CSV.");
    alertIn("#grouped",   "Missing expected columns in the CSV.");
    alertIn("#heatmap",   "Missing expected columns in the CSV.");
    alertIn("#stacked100","Missing expected columns in the CSV.");
    alertIn("#waffle",    "Missing expected columns in the CSV.");
    return;
  }

  const rows = raw.map(d => mapRow(d, C));

  // Country rows only (valid ISO3) — exclude "World" and regional aggregates
  const countries = rows.filter(r => isISO3(r.code) && r.entity !== "World");
  worldOnly = rows.filter(r => r.entity === "World");

  // 1) Top-10 bar
  d3.select("#year-top").text(SNAPSHOT_YEAR);
  drawTop10Bar("#bar-top10", countries, SNAPSHOT_YEAR);

  // 2) Grouped bar (selected countries)
  d3.select("#year-grouped").text(SNAPSHOT_YEAR);
  drawGroupedByType("#grouped", countries, SNAPSHOT_YEAR, FOCUS_COUNTRIES);

  // 3) Heatmap (World)
  drawWorldHeatmap("#heatmap", worldOnly);

  // 4) 100% stacked (World, over time)
  drawStacked100("#stacked100", worldOnly);

  // 5) Waffle (World, single year)
  d3.select("#year-waffle").text(SNAPSHOT_YEAR);
  drawWaffle("#waffle", worldOnly, SNAPSHOT_YEAR);

}).catch(err => {
  console.error(err);
  alertIn("#bar-top10", "Failed to load CSV (check path / CORS).");
  alertIn("#grouped",   "Failed to load CSV.");
  alertIn("#heatmap",   "Failed to load CSV.");
  alertIn("#stacked100","Failed to load CSV.");
  alertIn("#waffle",    "Failed to load CSV.");
});

/* ======================= CHARTS ======================= */

/* (1) Top-10 countries by conflict-related deaths (snapshot year) */
function drawTop10Bar(sel, data, year) {
  const rows = data.filter(d => d.year === year && d.total > 0);
  if (!rows.length) { alertIn(sel, `No country data for ${year}.`); return; }

  const top10 = rows.sort((a,b) => d3.descending(a.total, b.total)).slice(0, 10);

  const width = 900, height = 360;
  const margin = { top: 10, right: 28, bottom: 44, left: 220 };

  const svg = d3.select(sel).html("").append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleLinear()
    .domain([0, d3.max(top10, d => d.total) || 1]).nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(top10.map(d => d.entity))
    .range([margin.top, height - margin.bottom])
    .padding(0.18);

  // grid
  svg.append("g").attr("class", "grid")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6)
      .tickSize(-(height - margin.top - margin.bottom)).tickFormat(""));

  // axes
  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format(",")));

  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  // bars
  svg.append("g").selectAll("rect")
    .data(top10)
    .join("rect")
      .attr("x", x(0))
      .attr("y", d => y(d.entity))
      .attr("width", d => x(d.total) - x(0))
      .attr("height", y.bandwidth())
      .attr("fill", "#8da2fb")
      .on("mousemove", (ev, d) => {
        tip.style("opacity", 1)
          .html(`<strong>${d.entity}</strong><br/>${d3.format(",")(d.total)} deaths`)
          .style("left", (ev.pageX) + "px")
          .style("top",  (ev.pageY) + "px");
      })
      .on("mouseleave", () => tip.style("opacity", 0));

  // robust inline labels (auto inside/outside)
  const EDGE_PAD = 84;
  const fmt = d3.format(",");
  svg.append("g").selectAll("text.value")
    .data(top10)
    .join("text")
      .attr("class", "value")
      .attr("y", d => y(d.entity) + y.bandwidth() / 2)
      .attr("dy", "0.32em")
      .text(d => fmt(d.total))
      .attr("x", d => {
        const xr = x(d.total);
        return (width - margin.right - xr) < EDGE_PAD ? xr - 6 : xr + 6;
      })
      .attr("text-anchor", d => (width - margin.right - x(d.total)) < EDGE_PAD ? "end" : "start")
      .attr("fill", d => (width - margin.right - x(d.total)) < EDGE_PAD ? "white" : "#111827")
      .style("font-size", "12px");
}

/* (2) Grouped bar — selected countries × conflict type (snapshot year) */
function drawGroupedByType(sel, data, year, focus) {
  const keys = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
  const rows = data.filter(d => d.year === year && focus.includes(d.entity));
  if (!rows.length) { alertIn(sel, `No data for selected countries in ${year}.`); return; }

  const groups = focus.filter(c => rows.some(r => r.entity === c));
  const tidy = groups.map(g => {
    const d = rows.find(r => r.entity === g);
    return { group: g, values: keys.map(k => ({ key: k, value: d ? d[k] : 0 })) };
  });

  const width = 900, height = 360;
  const margin = { top: 10, right: 24, bottom: 64, left: 56 };

  const svg = d3.select(sel).html("").append("svg")
    .attr("width", width)
    .attr("height", height);

  const x0 = d3.scaleBand().domain(groups)
    .range([margin.left, width - margin.right]).padding(0.22);

  const x1 = d3.scaleBand().domain(keys)
    .range([0, x0.bandwidth()]).padding(0.08);

  const y = d3.scaleLinear()
    .domain([0, d3.max(tidy.flatMap(t => t.values), d => d.value) || 1]).nice()
    .range([height - margin.bottom, margin.top]);

  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x0))
    .selectAll("text")
      .attr("transform", "rotate(-18)")
      .style("text-anchor", "end");

  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(",")));

  svg.append("g").selectAll("g")
    .data(tidy)
    .join("g")
      .attr("transform", d => `translate(${x0(d.group)},0)`)
    .selectAll("rect")
    .data(d => d.values)
    .join("rect")
      .attr("x", d => x1(d.key))
      .attr("y", d => y(d.value))
      .attr("width",  x1.bandwidth())
      .attr("height", d => y(0) - y(d.value))
      .attr("fill",   d => TYPE_COLORS(d.key))
      .on("mousemove", (ev, d) => {
        tip.style("opacity", 1)
          .html(`<strong>${d.key}</strong><br/>${d3.format(",")(d.value)} deaths`)
          .style("left", (ev.pageX) + "px")
          .style("top",  (ev.pageY) + "px");
      })
      .on("mouseleave", () => tip.style("opacity", 0));

  // pill legend
  const legend = d3.select(sel).append("div").attr("class", "legend");
  TYPE_COLORS.domain().forEach(k => {
    const item = legend.append("span").attr("class", "pill");
    item.append("span").attr("class", "swatch").style("background", TYPE_COLORS(k));
    item.append("span").text(k);
  });
}

/* (3) Heatmap — World totals by type × year */
function drawWorldHeatmap(sel, worldRows) {
  if (!worldRows.length) { alertIn(sel, "No World aggregate rows found."); return; }

  const keys = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
  const years = worldRows.map(d => d.year).sort((a, b) => a - b);

  const cells = [];
  worldRows.forEach(d => keys.forEach(k => cells.push({ row: k, col: d.year, value: d[k] })));

  const width = 900, height = 280;
  const margin = { top: 36, right: 18, bottom: 36, left: 110 }; // extra top for legend title

  const svg = d3.select(sel).html("").append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleBand().domain(years)
    .range([margin.left, width - margin.right]).padding(0);

  const y = d3.scaleBand().domain(keys)
    .range([margin.top, height - margin.bottom]).padding(0.06);

  const max = d3.max(cells, d => d.value) || 1;
  const color = d3.scaleSequential(d3.interpolateOrRd).domain([0, max]);

  svg.append("g").selectAll("rect")
    .data(cells)
    .join("rect")
      .attr("x", d => x(d.col))
      .attr("y", d => y(d.row))
      .attr("width",  x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("fill", d => color(d.value))
      .on("mousemove", (ev, d) => {
        tip.style("opacity", 1)
          .html(`<strong>${d.row}</strong> — ${d.col}<br/>${d3.format(",")(d.value)} deaths`)
          .style("left", (ev.pageX) + "px")
          .style("top",  (ev.pageY) + "px");
      })
      .on("mouseleave", () => tip.style("opacity", 0));

  const xticks = years.filter(y => y % 4 === 0 || y === years[0] || y === years.at(-1));

  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(xticks).tickSize(0));

  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickSize(0));

  // Color legend + title
  const legendW = 220, legendH = 10, lx = width - legendW - 18, ly = margin.top - 22;
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", "hm-grad");
  grad.append("stop").attr("offset", "0%").attr("stop-color", color(0));
  grad.append("stop").attr("offset", "100%").attr("stop-color", color(max));
  svg.append("rect").attr("x", lx).attr("y", ly + 14).attr("width", legendW).attr("height", legendH).attr("fill", "url(#hm-grad)");

  const s = d3.scaleLinear().domain([0, max]).range([lx, lx + legendW]);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${ly + 14 + legendH})`)
    .call(d3.axisBottom(s).ticks(3).tickFormat(d3.format(",")));

  svg.append("text")
    .attr("x", lx + legendW / 2)
    .attr("y", ly + 2)
    .attr("text-anchor", "middle")
    .attr("fill", "#555")
    .attr("font-size", "12px")
    .text("Number of deaths (log scale)"); // label now clearly visible
}

/* (4) 100% stacked — World, share by type over time */
function drawStacked100(sel, worldRows) {
  if (!worldRows.length) { alertIn(sel, "No World aggregate rows found."); return; }

  const keys = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
  const years = worldRows.map(d => d.year).sort((a, b) => a - b);

  // Normalize each year to proportions that sum to 1
  const stackedData = years.map(y => {
    const r = worldRows.find(d => d.year === y);
    const totals = keys.reduce((acc, k) => acc + (+r[k] || 0), 0) || 1;
    const obj = { year: y };
    keys.forEach(k => obj[k] = (+r[k] || 0) / totals);
    return obj;
  });

  const series = d3.stack().keys(keys)(stackedData);

  const width = 900, height = 300;
  const margin = { top: 10, right: 18, bottom: 40, left: 56 };

  const svg = d3.select(sel).html("").append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleBand().domain(years)
    .range([margin.left, width - margin.right]).padding(0.15);

  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);

  // axes
  const xticks = years.filter(yv => yv % 4 === 0 || yv === years[0] || yv === years.at(-1));
  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(xticks));

  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => d3.format(".0%")(d)));

  // bars
  svg.append("g").selectAll("g.layer")
    .data(series)
    .join("g")
      .attr("class", "layer")
      .attr("fill", d => TYPE_COLORS(d.key))
    .selectAll("rect")
    .data(d => d.map(v => ({ key: d.key, x: v.data.year, y0: v[0], y1: v[1] })))
    .join("rect")
      .attr("x", d => x(d.x))
      .attr("y", d => y(d.y1))
      .attr("height", d => y(d.y0) - y(d.y1))
      .attr("width", x.bandwidth())
      .on("mousemove", (ev, d) => {
        const pct = d3.format(".0%")(d.y1 - d.y0);
        tip.style("opacity", 1)
           .html(`<strong>${d.key}</strong> — ${d.x}<br/>${pct} share`)
           .style("left", (ev.pageX) + "px")
           .style("top",  (ev.pageY) + "px");
      })
      .on("mouseleave", () => tip.style("opacity", 0));

  // legend
  const legend = d3.select(sel).append("div").attr("class", "legend");
  TYPE_COLORS.domain().forEach(k => {
    const item = legend.append("span").attr("class", "pill");
    item.append("span").attr("class", "swatch").style("background", TYPE_COLORS(k));
    item.append("span").text(k);
  });
}

/* (5) Waffle — World composition in a single year (10×10 grid) */
function drawWaffle(sel, worldRows, year) {
  const keys = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
  const w = worldRows.find(d => d.year === year);
  if (!w) { alertIn(sel, `No World aggregate for ${year}.`); return; }

  const totals = keys.map(k => ({ key: k, value: +w[k] || 0 }));
  const grandTotal = d3.sum(totals, d => d.value);
  if (!grandTotal) { alertIn(sel, `World total is zero in ${year}.`); return; }

  // Allocate 100 cells by proportional rounding (largest remainders)
  const raw = totals.map(d => {
    const exact = (d.value / grandTotal) * 100;
    return { key: d.key, exact, cells: Math.floor(exact), value: d.value };
  });
  let used = d3.sum(raw, d => d.cells);
  let missing = 100 - used;
  const order = raw.slice().sort((a, b) => d3.descending(a.exact - Math.floor(a.exact), b.exact - Math.floor(b.exact)));

  for (let i = 0; i < Math.abs(missing); i++) {
    const r = order[i % order.length];
    r.cells += (missing > 0 ? 1 : -1);
  }

  const cells = [];
  raw.forEach(r => { for (let i = 0; i < Math.max(0, r.cells); i++) cells.push({ key: r.key }); });
  while (cells.length < 100) cells.push({ key: order[0].key });
  if (cells.length > 100) cells.length = 100;

  const width = 900, height = 320;
  const margin = { top: 18, right: 18, bottom: 56, left: 18 };
  const cols = 10, rows = 10, gap = 4;

  const svg = d3.select(sel).html("").append("svg")
    .attr("width", width).attr("height", height);

  const cellSize = Math.min(
    Math.floor((width  - margin.left - margin.right  - gap * (cols - 1)) / cols),
    Math.floor((height - margin.top  - margin.bottom - gap * (rows - 1)) / rows)
  );
  const gridW = cellSize * cols + gap * (cols - 1);
  const gridH = cellSize * rows + gap * (rows - 1);
  const gridX = margin.left + Math.floor((width  - margin.left - margin.right  - gridW) / 2);
  const gridY = margin.top + 10;

  const g = svg.append("g").attr("transform", `translate(${gridX},${gridY})`);
  g.selectAll("rect")
    .data(cells)
    .join("rect")
      .attr("x", (_, i) => (i % cols) * (cellSize + gap))
      .attr("y", (_, i) => Math.floor(i / cols) * (cellSize + gap))
      .attr("width",  cellSize)
      .attr("height", cellSize)
      .attr("rx", 3).attr("ry", 3)
      .attr("fill", d => TYPE_COLORS(d.key))
      .on("mousemove", (ev, d) => {
        const count = totals.find(t => t.key === d.key)?.value || 0;
        const share = d3.format(".0%")(count / grandTotal);
        tip.style("opacity", 1)
           .html(`<strong>${d.key}</strong><br/>${d3.format(",")(count)} deaths<br/>${share} of ${year}`)
           .style("left", (ev.pageX) + "px")
           .style("top",  (ev.pageY) + "px");
      })
      .on("mouseleave", () => tip.style("opacity", 0));

  // legend + caption
  const legend = d3.select(sel).append("div").attr("class", "legend");
  TYPE_COLORS.domain().forEach(k => {
    const item = legend.append("span").attr("class", "pill");
    item.append("span").attr("class", "swatch").style("background", TYPE_COLORS(k));
    item.append("span").text(k);
  });

  d3.select(sel).append("div").attr("class", "caption")
    .text(`Waffle chart: 10×10 grid = 100 squares. Each square ≈ 1% of global deaths in ${year} (UCDP “World” totals). Colors encode UCDP conflict types.`);
}
