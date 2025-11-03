// =======================================================
// Data Visualization — Comparing Categories (OWID / UCDP)
// Robust version: auto-detect latest year, filter real countries,
// keep aggregates out, and render the 5 required charts.
// =======================================================

// ---- PATHS ----
const DATA_PATH = "data/conflict_deaths_by_type.csv";

// ---- COLORS (fixed and color-blind friendly) ----
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"])
  .range(["#6c8ae4","#f28e2b","#edc948","#59a14f","#e15759"]);

// Countries to show in the grouped bar (must exist in your CSV)
const FOCUS_COUNTRIES = [
  "Ukraine", "Mexico", "Sudan", "Somalia", "Burkina Faso"
];

// ---------- Helpers ----------
const fmtInt = d3.format(",");     // 12,345
const fmtPct = d3.format(".0%");

// Identify OWID aggregates reliably (e.g., World, regions)
function isAggregate(row) {
  // OWID use ISO3 for countries and OWID_* for aggregates.
  // Accept only pure ISO3 codes (3 uppercase letters) and exclude OWID_*.
  const code = row?.Code || row?.code || "";
  if (!code) return true;
  if (code.startsWith("OWID_")) return true;
  return !/^[A-Z]{3}$/.test(code); // not an ISO3 country
}

// Safely get column names (case-insensitive includes)
function detectColumns(sample) {
  const headers = Object.keys(sample);
  const find = (kw) => headers.find(h => h.toLowerCase().includes(kw)) || null;

  return {
    entity: find("entity") || "Entity",
    code: find("code") || "Code",
    year: find("year") || "Year",
    interstate: find("conflict type: interstate"),
    intrastate: find("conflict type: intrastate"),
    extrasystemic: find("conflict type: extrasystemic"),
    nonstate: find("conflict type: non-state"),
    onesided: find("conflict type: one-sided")
  };
}

// ---------- Load & Prepare ----------
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw || !raw.length) {
    console.error("CSV not found or empty.");
    return;
  }

  const COL = detectColumns(raw[0]);
  const NEED = ["interstate","intrastate","nonstate","onesided"];
  if (NEED.some(k => !COL[k])) {
    console.warn("Some conflict-type columns were not detected. Headers are:", Object.keys(raw[0]));
  }

  // Normalize rows + compute total
  const rows = raw.map(r => {
    const item = {
      entity: r[COL.entity],
      code: r[COL.code],
      year: +r[COL.year],
      Interstate: +r[COL.interstate] || 0,
      Intrastate: +r[COL.intrastate] || 0,
      Extrasystemic: +r[COL.extrasystemic] || 0,
      "Non-state": +r[COL.nonstate] || 0,
      "One-sided": +r[COL.onesided] || 0
    };
    item.total = item.Interstate + item.Intrastate + item.Extrasystemic + item["Non-state"] + item["One-sided"];
    return item;
  });

  // Latest available year in the file (robust against updates)
  const latestYear = d3.max(rows, d => d.year);

  // Convenience selectors
  const byYear = y => rows.filter(d => d.year === y);
  const worldSeries = rows.filter(d => d.entity === "World").sort((a,b)=>a.year-b.year);

  // =====================================================
  // 1) BARCHART — Top 10 countries by conflict deaths (latest year)
  // =====================================================
  {
    const yearRows = byYear(latestYear)
      .filter(d => !isAggregate(d) && d.total > 0); // keep countries only
    const top10 = yearRows
      .sort((a,b) => d3.descending(a.total, b.total))
      .slice(0, 10)
      .map(d => ({ name: d.entity, value: d.total }));

    drawHorizontalBar("#bar-top10-2024", top10, {
      width: 980,
      height: 430,
      title: `Countries with the highest conflict-related deaths in ${latestYear} (Top 10)`,
      xFormat: fmtInt
    });

    addSource("#bar-top10-2024", "Source: UCDP via Our World in Data. Values are absolute counts.");
  }

  // =====================================================
  // 2) GROUPED BAR — deaths by type for selected countries (latest year)
  // =====================================================
  {
    const KEYS = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];

    // Keep only selected countries that exist in the file
    const yearRows = byYear(latestYear).filter(d =>
      !isAggregate(d) && FOCUS_COUNTRIES.includes(d.entity)
    );

    const tidy = yearRows.map(d => ({
      group: d.entity,
      values: KEYS.map(k => ({ key: k, value: d[k] }))
    }));

    drawGroupedBar("#grouped-2024", tidy, {
      keys: KEYS,
      width: 980,
      height: 440,
      title: `Conflict deaths by type (selected countries, ${latestYear})`
    });

    addSource("#grouped-2024", "Source: UCDP via Our World in Data. Categories are conflict types.");
  }

  // =====================================================
  // 3) HEATMAP — global deaths by type and year (World)
  // =====================================================
  {
    const KEYS = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
    const matrix = [];

    worldSeries.forEach(d => {
      KEYS.forEach(k => matrix.push({ row: k, col: d.year, value: d[k] }));
    });

    drawHeatmap("#heatmap-global", matrix, {
      width: 980,
      height: 280,
      title: "Global conflict deaths by type and year"
    });

    addSource("#heatmap-global", "Source: UCDP via Our World in Data. Color encodes absolute counts.");
  }

  // =====================================================
  // 4) 100% STACKED BAR — share of each type by year (World)
  // =====================================================
  {
    const KEYS = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
    const series = worldSeries.map(d => {
      const total = d.total || 1;
      const o = { year: d.year };
      KEYS.forEach(k => { o[k] = (d[k] || 0) / total; });
      return o;
    });

    drawStacked100("#stacked-100", series, {
      keys: KEYS,
      width: 980,
      height: 320,
      title: "Share of conflict deaths by type (World, 100% stacked)"
    });

    addSource("#stacked-100", "Source: UCDP via Our World in Data. Bars sum to 100% per year.");
  }

  // =====================================================
  // 5) WAFFLE — composition in the latest year (World)
  // =====================================================
  {
    const w = worldSeries.find(d => d.year === latestYear) || worldSeries.at(-1);
    const parts = [
      { name: "Interstate",   value: w?.Interstate   || 0 },
      { name: "Intrastate",   value: w?.Intrastate   || 0 },
      { name: "Extrasystemic",value: w?.Extrasystemic|| 0 },
      { name: "Non-state",    value: w?.["Non-state"]|| 0 },
      { name: "One-sided",    value: w?.["One-sided"]|| 0 }
    ];

    drawWaffle("#waffle-2024", parts, {
      cols: 10,
      rows: 10,
      size: 18,
      gap: 2,
      title: `Composition of global conflict deaths by type in ${latestYear} (World)`
    });

    addSource("#waffle-2024", "Source: UCDP via Our World in Data. Each square ≈ 1% of the total.");
  }
})
.catch(err => console.error("Failed to load CSV:", err));

/* =====================================================
   Components
===================================================== */

// Horizontal bar chart
function drawHorizontalBar(sel, data, {
  width = 900,
  height = 380,
  margin = { top: 16, right: 24, bottom: 44, left: 200 },
  title = "",
  xFormat = d3.format(",")
} = {}) {
  if (!data || !data.length) return;

  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);
  if (title) svg.append("text").attr("x", margin.left).attr("y", 14).attr("class", "chart-title").text(title);

  const innerTop = margin.top + (title ? 16 : 0);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.value) || 1]).nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map(d => d.name))
    .range([innerTop, height - margin.bottom])
    .padding(0.15);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x).ticks(6).tickFormat(xFormat));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y));

  svg.append("g").selectAll("rect").data(data).join("rect")
    .attr("x", x(0))
    .attr("y", d => y(d.name))
    .attr("width", d => x(d.value) - x(0))
    .attr("height", y.bandwidth())
    .attr("fill", "#8aa6ff");
}

// Grouped bar
function drawGroupedBar(sel, rows, {
  keys,
  width = 980,
  height = 420,
  margin = { top: 16, right: 24, bottom: 72, left: 56 },
  title = ""
} = {}) {
  if (!rows || !rows.length) return;

  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);
  if (title) svg.append("text").attr("x", margin.left).attr("y", 14).attr("class", "chart-title").text(title);

  const innerTop = margin.top + (title ? 16 : 0);
  const groups = rows.map(d => d.group);
  const flat = rows.flatMap(d => d.values.map(v => ({ group: d.group, key: v.key, value: v.value })));

  const x0 = d3.scaleBand().domain(groups).range([margin.left, width - margin.right]).padding(0.2);
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear().domain([0, d3.max(flat, d => d.value) || 1]).nice().range([height - margin.bottom, innerTop]);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x0))
    .selectAll("text")
    .attr("transform", "rotate(-18)")
    .style("text-anchor", "end");

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(5));

  svg.append("g").selectAll("g").data(rows).join("g")
    .attr("transform", d => `translate(${x0(d.group)},0)`)
    .selectAll("rect").data(d => d.values).join("rect")
    .attr("x", d => x1(d.key))
    .attr("y", d => y(d.value))
    .attr("width", x1.bandwidth())
    .attr("height", d => y(0) - y(d.value))
    .attr("fill", d => TYPE_COLORS(d.key));

  // Legend
  const legend = d3.select(sel).append("div").attr("class", "legend");
  keys.forEach(k => legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`));
}

// Heatmap
function drawHeatmap(sel, matrix, {
  width = 980,
  height = 260,
  margin = { top: 28, right: 20, bottom: 32, left: 96 },
  title = ""
} = {}) {
  if (!matrix || !matrix.length) return;

  const years = [...new Set(matrix.map(d => d.col))].sort((a, b) => a - b);
  const rows = [...new Set(matrix.map(d => d.row))];

  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);
  if (title) svg.append("text").attr("x", margin.left).attr("y", 18).attr("class", "chart-title").text(title);

  const innerTop = margin.top + (title ? 10 : 0);
  const cellW = (width - margin.left - margin.right) / years.length;
  const cellH = (height - innerTop - margin.bottom) / rows.length;

  const max = d3.max(matrix, d => d.value) || 1;
  const color = d3.scaleSequential(d3.interpolateOrRd).domain([0, max]);

  const g = svg.append("g");

  rows.forEach((r, ri) => {
    years.forEach((y, ci) => {
      const v = matrix.find(d => d.row === r && d.col === y)?.value || 0;
      g.append("rect")
        .attr("x", margin.left + ci * cellW)
        .attr("y", innerTop + ri * cellH)
        .attr("width", cellW)
        .attr("height", cellH)
        .attr("fill", color(v));
    });
  });

  const xAxis = d3.axisBottom(d3.scalePoint().domain(years.filter(y => y % 4 === 0)).range([margin.left, width - margin.right]));
  const yAxis = d3.axisLeft(d3.scalePoint().domain(rows).range([innerTop, height - margin.bottom]));

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).attr("class", "axis").call(xAxis);
  svg.append("g").attr("transform", `translate(${margin.left},0)`).attr("class", "axis").call(yAxis);
}

// 100% Stacked bars
function drawStacked100(sel, series, {
  keys,
  width = 980,
  height = 320,
  margin = { top: 16, right: 24, bottom: 40, left: 56 },
  title = ""
} = {}) {
  if (!series || !series.length) return;

  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);
  if (title) svg.append("text").attr("x", margin.left).attr("y", 14).attr("class", "chart-title").text(title);

  const innerTop = margin.top + (title ? 16 : 0);

  const x = d3.scaleBand().domain(series.map(d => d.year)).range([margin.left, width - margin.right]).padding(0.08);
  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, innerTop]);

  const stack = d3.stack().keys(keys)(series);

  svg.append("g").selectAll("g").data(stack).join("g")
    .attr("fill", d => TYPE_COLORS(d.key))
    .selectAll("rect").data(d => d).join("rect")
    .attr("x", d => x(d.data.year))
    .attr("y", d => y(d[1]))
    .attr("height", d => y(d[0]) - y(d[1]))
    .attr("width", x.bandwidth());

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).attr("class", "axis")
    .call(d3.axisBottom(x).tickValues(x.domain().filter(y => y % 4 === 0)));
  svg.append("g").attr("transform", `translate(${margin.left},0)`).attr("class", "axis")
    .call(d3.axisLeft(y).tickFormat(fmtPct));

  const legend = d3.select(sel).append("div").attr("class", "legend");
  keys.forEach(k => legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`));
}

// Waffle chart
function drawWaffle(sel, parts, {
  cols = 10,
  rows = 10,
  size = 18,
  gap = 2,
  title = ""
} = {}) {
  if (!parts || !parts.length) return;

  const total = d3.sum(parts, d => d.value) || 1;
  const units = parts.map(d => ({ name: d.name, units: Math.round(100 * (d.value / total)) }));

  let tiles = [];
  units.forEach(u => { for (let i = 0; i < u.units; i++) tiles.push({ name: u.name }); });
  tiles = tiles.slice(0, cols * rows);

  const width = cols * (size + gap) + 20;
  const height = rows * (size + gap) + 26;

  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);
  if (title) svg.append("text").attr("x", 10).attr("y", 16).attr("class", "chart-title").text(title);

  svg.append("g").attr("transform", "translate(10,6)")
    .selectAll("rect").data(tiles).join("rect")
    .attr("x", (d, i) => (i % cols) * (size + gap))
    .attr("y", (d, i) => Math.floor(i / cols) * (size + gap))
    .attr("width", size).attr("height", size)
    .attr("fill", d => TYPE_COLORS(d.name));

  const legend = d3.select(sel).append("div").attr("class", "legend");
  parts.forEach(p => legend.append("span").html(`<i style="background:${TYPE_COLORS(p.name)}"></i>${p.name}`));
}

// Small source line under a chart container
function addSource(sel, text) {
  d3.select(sel).append("div").attr("class", "source-note").text(text);
}
