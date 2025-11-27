/*******************************************************
 * Visualizing Conflict and Human Suffering — JS bundle
 * Dataset: UCDP via Our World in Data
 *
 * Section 1 — Comparing categories
 *  1) Top-10 barchart (absolute)            → #bar-top10
 *  2) Grouped barchart (selected countries) → #grouped
 *  3) Heatmap (World totals, type × year)   → #heatmap
 *  4) 100% stacked barchart (World shares)  → #stack100
 *  5) Waffle chart (World composition Y)    → #waffle
 *
 * Section 2 — Distributions (snapshot year)
 *  6) Histogram (country totals)            → #histogram
 *  7) Violin plot (by conflict type)        → #violin
 *  8) Boxplot (by conflict type)            → #boxplot
 *
 * Section 3 — Temporal patterns
 *  9) Line chart (World totals over time)   → #timeseries
 *
 * Section 4 — Spatial patterns
 * 10) Choropleth map (country totals, Y)    → #map-choropleth
 *******************************************************/

/* ---------- Global configuration ---------- */

/** Path to the main CSV dataset (UCDP / OWID export). */
const DATA_PATH = "data/conflict_deaths_by_type.csv";

/** Path to the world countries GeoJSON (Natural Earth or similar). */
const WORLD_GEOJSON_PATH = "data/world_countries.geojson";

/** Snapshot year used for “per country” charts and maps. */
const SNAPSHOT_YEAR = 2023;

/** Countries highlighted in the grouped barchart. */
const FOCUS_COUNTRIES = ["Ukraine", "Palestine", "Sudan", "Mexico", "Burkina Faso"];

/** Fixed order of conflict types across all visualizations. */
const TYPE_ORDER = ["Interstate", "Intrastate", "Extrasystemic", "Non-state", "One-sided"];

/** Color scale for conflict types (ordinal, consistent across charts). */
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(TYPE_ORDER)
  .range(["#6c8ae4", "#f28e2b", "#edc948", "#59a14f", "#e15759"]);

/**
 * List of all visualization containers used in the HTML.
 * This is used for displaying global error messages in a single place.
 */
const ALL_VIZ_SELECTORS = [
  "#bar-top10",
  "#grouped",
  "#heatmap",
  "#stack100",
  "#waffle",
  "#histogram",
  "#violin",
  "#boxplot",
  "#timeseries",
  "#map-choropleth"
];

/* ---------- Shared tooltip ---------- */

/** Single floating tooltip reused by all charts and the map. */
const tip = d3.select("body")
  .append("div")
  .attr("class", "tooltip")
  .style("opacity", 0);

/**
 * Show the shared tooltip at the mouse pointer position.
 * @param {MouseEvent} ev  – the DOM mouse event
 * @param {string} html    – HTML content to be injected into the tooltip
 */
function showTooltip(ev, html) {
  tip
    .style("opacity", 1)
    .html(html)
    .style("left", ev.pageX + "px")
    .style("top", ev.pageY + "px");
}

/**
 * Hide the shared tooltip.
 */
function hideTooltip() {
  tip.style("opacity", 0);
}

/* ---------- Generic utilities ---------- */

/**
 * Inject a lightweight alert message into a target container.
 * Used when data are missing or cannot be parsed correctly.
 */
function alertIn(sel, msg) {
  const box = d3.select(sel);
  if (!box.empty()) {
    box.html("")
      .append("div")
      .attr("class", "alert")
      .text(msg);
  }
}

/**
 * Test whether a code is a “true” ISO-3 country code.
 * This is used to remove regional aggregates and other non-country entities.
 */
const isISO3 = code =>
  typeof code === "string" && /^[A-Z]{3}$/.test(code);

/**
 * Discover column names in a potentially noisy OWID-style CSV header.
 * The function is robust to minor wording changes.
 */
function detectColumns(headers) {
  const norm = s => s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  const H = headers.map(h => ({ raw: h, n: norm(h) }));

  const pick = (...needles) => {
    const i = H.findIndex(({ n }) =>
      needles.some(nd => n.includes(nd))
    );
    return i >= 0 ? H[i].raw : null;
  };

  return {
    entity:        pick("entity") || "Entity",
    code:          pick("code")   || "Code",
    year:          pick("year")   || "Year",
    // OWID style: “… - Conflict type: interstate”, etc.
    interstate:    pick("conflict type: interstate", " interstate"),
    intrastate:    pick("conflict type: intrastate", " intrastate"),
    extrasystemic: pick("conflict type: extrasystemic", " extrasystemic"),
    nonstate:      pick("conflict type: non-state", " non state", " non-state conflict"),
    onesided:      pick("conflict type: one-sided", " one-sided violence", " one sided")
  };
}

/**
 * Normalize one CSV row into canonical fields and compute a total.
 * This function returns one object per CSV row with standardized keys.
 */
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

  r.total = TYPE_ORDER.reduce((acc, k) => acc + (r[k] || 0), 0);
  r.iso3  = r.code;
  return r;
}

/**
 * Append a pill-style legend for the conflict types to a given container.
 * This helper is reused by multiple charts that share the same legend.
 */
function addTypeLegend(sel) {
  const legend = d3.select(sel)
    .append("div")
    .attr("class", "legend");

  TYPE_ORDER.forEach(k => {
    const item = legend.append("span")
      .attr("class", "pill");

    item.append("span")
      .attr("class", "swatch")
      .style("background", TYPE_COLORS(k));

    item.append("span").text(k);
  });
}

/* ---------- Data loading and dispatch ---------- */

Promise.all([
  d3.csv(DATA_PATH, d3.autoType),
  d3.json(WORLD_GEOJSON_PATH)
]).then(([raw, worldGeo]) => {
  if (!raw || !raw.length) {
    throw new Error("CSV is empty.");
  }

  // Detect column names in a robust way.
  const headers = Object.keys(raw[0]);
  const C = detectColumns(headers);

  // Minimal set of columns required to render the visualizations.
  const required = [
    C.entity,
    C.code,
    C.year,
    C.intrastate,
    C.nonstate,
    C.onesided
  ];

  if (required.some(x => !x)) {
    ALL_VIZ_SELECTORS.forEach(sel =>
      alertIn(sel, "Could not detect required columns in the CSV.")
    );
    return;
  }

  // Normalize rows and split into “World” vs country-level entities.
  const rows       = raw.map(d => mapRow(d, C));
  const countries  = rows.filter(r => isISO3(r.code) && r.entity !== "World");
  const worldOnly  = rows.filter(r => r.entity === "World");

  // Extract GeoJSON features in a safe way.
  const worldFeatures = Array.isArray(worldGeo?.features)
    ? worldGeo.features
    : worldGeo;

  const worldFC = {
    type: "FeatureCollection",
    features: worldFeatures
  };

  // Update year labels in the HTML.
  d3.select("#year-top").text(SNAPSHOT_YEAR);
  d3.select("#year-grouped").text(SNAPSHOT_YEAR);
  d3.select("#year-waffle").text(SNAPSHOT_YEAR);
  d3.select("#waffle-year").text(SNAPSHOT_YEAR);

  /* ---- Section 1: Comparing categories ---- */

  drawTop10Bar("#bar-top10", countries, SNAPSHOT_YEAR);
  drawGroupedByType("#grouped", countries, SNAPSHOT_YEAR, FOCUS_COUNTRIES);
  drawWorldHeatmap("#heatmap", worldOnly);
  drawStacked100("#stack100", worldOnly);
  drawWaffle("#waffle", worldOnly, SNAPSHOT_YEAR);

  /* ---- Section 2: Distributions ---- */

  drawHistogram("#histogram", countries, SNAPSHOT_YEAR);
  drawViolin("#violin", countries, SNAPSHOT_YEAR);
  drawBoxplot("#boxplot", countries, SNAPSHOT_YEAR);

  /* ---- Section 3: Temporal patterns ---- */

  drawTimeSeries("#timeseries", worldOnly);

  /* ---- Section 4: Spatial patterns ---- */

  try {
    drawChoropleth("#map-choropleth", worldFC, countries, SNAPSHOT_YEAR);
  } catch (e) {
    console.error("Failed to render choropleth:", e);
    alertIn("#map-choropleth", "Could not render map (GeoJSON error).");
  }

}).catch(err => {
  console.error(err);
  ALL_VIZ_SELECTORS.forEach(sel =>
    alertIn(sel, "Failed to load data. Expected CSV and GeoJSON in /data.")
  );
});

/* ===================== CHARTS ===================== */

/* 1) Top-10 barchart (absolute totals per country) */
function drawTop10Bar(sel, data, year) {
  const rows = data.filter(d => d.year === year && d.total > 0);
  if (!rows.length) {
    alertIn(sel, `No country data for year ${year}.`);
    return;
  }

  const top10 = rows
    .sort((a, b) => d3.descending(a.total, b.total))
    .slice(0, 10);

  const width  = 900;
  const height = 360;
  const margin = { top: 10, right: 28, bottom: 44, left: 220 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleLinear()
    .domain([0, d3.max(top10, d => d.total) || 1])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(top10.map(d => d.entity))
    .range([margin.top, height - margin.bottom])
    .padding(0.18);

  // Horizontal grid lines.
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(6)
        .tickSize(-(height - margin.top - margin.bottom))
        .tickFormat("")
    );

  // Axes.
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format(",")));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  // Bars.
  svg.append("g")
    .selectAll("rect")
    .data(top10)
    .join("rect")
    .attr("x", x(0))
    .attr("y", d => y(d.entity))
    .attr("width", d => x(d.total) - x(0))
    .attr("height", y.bandwidth())
    .attr("fill", "#8da2fb")
    .on("mousemove", (ev, d) => {
      const html = `<strong>${d.entity}</strong><br/>${d3.format(",")(d.total)} deaths`;
      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  // Value labels with a small “edge avoidance” heuristic.
  const fmt = d3.format(",");
  const EDGE_PAD = 84;

  svg.append("g")
    .selectAll("text.value")
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
    .attr("text-anchor", d =>
      (width - margin.right - x(d.total)) < EDGE_PAD ? "end" : "start"
    )
    .attr("fill", d =>
      (width - margin.right - x(d.total)) < EDGE_PAD ? "white" : "#111827"
    )
    .style("font-size", "12px");
}

/* 2) Grouped barchart — selected countries × conflict type */
function drawGroupedByType(sel, data, year, focus) {
  const rows = data.filter(d => d.year === year && focus.includes(d.entity));
  if (!rows.length) {
    alertIn(sel, `No data for selected countries in ${year}.`);
    return;
  }

  const groups = focus.filter(c => rows.some(r => r.entity === c));
  const tidy = groups.map(g => {
    const d = rows.find(r => r.entity === g);
    return {
      group: g,
      values: TYPE_ORDER.map(k => ({ key: k, value: d ? d[k] : 0 }))
    };
  });

  const width  = 900;
  const height = 360;
  const margin = { top: 10, right: 24, bottom: 62, left: 56 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x0 = d3.scaleBand()
    .domain(groups)
    .range([margin.left, width - margin.right])
    .padding(0.22);

  const x1 = d3.scaleBand()
    .domain(TYPE_ORDER)
    .range([0, x0.bandwidth()])
    .padding(0.08);

  const y = d3.scaleLinear()
    .domain([
      0,
      d3.max(tidy.flatMap(t => t.values), d => d.value) || 1
    ])
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x0))
    .selectAll("text")
    .attr("transform", "rotate(-18)")
    .style("text-anchor", "end");

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(",")));

  svg.append("g")
    .selectAll("g")
    .data(tidy)
    .join("g")
    .attr("transform", d => `translate(${x0(d.group)},0)`)
    .selectAll("rect")
    .data(d => d.values)
    .join("rect")
    .attr("x", d => x1(d.key))
    .attr("y", d => y(d.value))
    .attr("width", x1.bandwidth())
    .attr("height", d => y(0) - y(d.value))
    .attr("fill", d => TYPE_COLORS(d.key))
    .on("mousemove", (ev, d) => {
      const html = `<strong>${d.key}</strong><br/>${d3.format(",")(d.value)} deaths`;
      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  // Type legend (shared helper).
  addTypeLegend(sel);
}

/* 3) Heatmap — World totals per type × year */
function drawWorldHeatmap(sel, worldRows) {
  if (!worldRows.length) {
    alertIn(sel, "No World aggregate rows found.");
    return;
  }

  const years = worldRows.map(d => d.year).sort((a, b) => a - b);
  const cells = [];

  worldRows.forEach(d =>
    TYPE_ORDER.forEach(k =>
      cells.push({ row: k, col: d.year, value: d[k] })
    )
  );

  const width  = 900;
  const height = 280;
  const margin = { top: 36, right: 18, bottom: 34, left: 110 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleBand()
    .domain(years)
    .range([margin.left, width - margin.right])
    .padding(0);

  const y = d3.scaleBand()
    .domain(TYPE_ORDER)
    .range([margin.top, height - margin.bottom])
    .padding(0.06);

  const max = d3.max(cells, d => d.value) || 1;
  const color = d3.scaleSequential(d3.interpolateOrRd)
    .domain([0, max]);

  svg.append("g")
    .selectAll("rect")
    .data(cells)
    .join("rect")
    .attr("x", d => x(d.col))
    .attr("y", d => y(d.row))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("fill", d => color(d.value))
    .on("mousemove", (ev, d) => {
      const html =
        `<strong>${d.row}</strong> — ${d.col}<br/>` +
        `${d3.format(",")(d.value)} deaths`;
      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  const xticks = years.filter(
    yv => yv % 4 === 0 || yv === years[0] || yv === years.at(-1)
  );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(xticks).tickSize(0));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickSize(0));

  // Gradient legend + label.
  const legendW = 220;
  const legendH = 10;
  const legendX = width - legendW - 18;
  const legendY = margin.top - 18;

  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", "hm-grad");

  grad.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", color(0));

  grad.append("stop")
    .attr("offset", "100%")
    .attr("stop-color", color(max));

  svg.append("rect")
    .attr("x", legendX)
    .attr("y", legendY)
    .attr("width", legendW)
    .attr("height", legendH)
    .attr("fill", "url(#hm-grad)");

  const s = d3.scaleLog()
    .domain([1, max])
    .range([legendX, legendX + legendW]);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${legendY + legendH})`)
    .call(d3.axisBottom(s).ticks(3, "~s"));

  svg.append("text")
    .attr("x", legendX + legendW / 2)
    .attr("y", legendY - 6)
    .attr("text-anchor", "middle")
    .attr("fill", "#555")
    .attr("font-size", 12)
    .text("Number of deaths (log scale)");
}

/* 4) 100% stacked barchart — World shares by type over time */
function drawStacked100(sel, worldRows) {
  if (!worldRows.length) {
    alertIn(sel, "No World aggregate rows found.");
    return;
  }

  const absByYear = new Map(
    worldRows.map(r => [r.year, r])
  );

  const years = worldRows
    .map(d => d.year)
    .sort((a, b) => a - b);

  const propRows = years.map(y => {
    const d   = absByYear.get(y);
    const sum = d3.sum(TYPE_ORDER, k => d[k] || 0) || 1;
    const r   = { year: y };

    TYPE_ORDER.forEach(k => {
      r[k] = (d[k] || 0) / sum;
    });

    return r;
  });

  const width  = 900;
  const height = 360;
  const margin = { top: 8, right: 24, bottom: 58, left: 52 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleBand()
    .domain(years)
    .range([margin.left, width - margin.right])
    .padding(0.08);

  const y = d3.scaleLinear()
    .domain([0, 1])
    .range([height - margin.bottom, margin.top]);

  const stack = d3.stack()
    .keys(TYPE_ORDER)
    .order(d3.stackOrderNone)
    .offset(d3.stackOffsetExpand);

  const series = stack(propRows);

  // Light horizontal grid.
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .tickValues([0, 0.25, 0.5, 0.75, 1])
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    )
    .selectAll("line")
    .attr("opacity", 0.35);

  // Bars.
  svg.append("g")
    .selectAll("g")
    .data(series)
    .join("g")
    .attr("fill", d => TYPE_COLORS(d.key))
    .selectAll("rect")
    .data(d => d)
    .join("rect")
    .attr("x", d => x(d.data.year))
    .attr("y", d => y(d[1]))
    .attr("height", d => y(d[0]) - y(d[1]))
    .attr("width", x.bandwidth())
    .on("mousemove", (ev, d) => {
      const key  = d3.select(ev.currentTarget.parentNode).datum().key;
      const year = d.data.year;
      const pct  = (d[1] - d[0]) * 100;
      const abs  = absByYear.get(year)?.[key] ?? 0;

      const html =
        `<strong>${key}</strong> — ${year}<br/>` +
        `${pct.toFixed(0)}%  (${d3.format(",")(abs)} deaths)`;
      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  // Axes.
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .tickValues(years.filter(yv => yv % 2 === 0))
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .tickValues([0, 0.25, 0.5, 0.75, 1])
        .tickFormat(d3.format(".0%"))
    );

  // Type legend (shared helper).
  addTypeLegend(sel);
}

/* 5) Waffle chart — World composition in a single year */
function drawWaffle(sel, worldRows, year) {
  const d = worldRows.find(r => r.year === year);
  if (!d) {
    alertIn(sel, `No World data for year ${year}.`);
    return;
  }

  const totals = TYPE_ORDER.map(k => d[k] || 0);
  const sum    = d3.sum(totals) || 1;

  const shares = TYPE_ORDER.map(k => ({
    key:   k,
    value: d[k] || 0,
    pct:   (d[k] || 0) / sum
  }));

  const cols       = 10;
  const rows       = 10;
  const totalCells = cols * rows;

  const cellsByType = shares.map(s => ({
    key:   s.key,
    cells: Math.round(s.pct * totalCells),
    value: s.value,
    pct:   s.pct
  }));

  const used = d3.sum(cellsByType, c => c.cells);

  if (used !== totalCells) {
    const diff = totalCells - used;
    cellsByType[0].cells += diff;
  }

  const grid = [];
  cellsByType.forEach(s => {
    for (let i = 0; i < s.cells; i += 1) {
      grid.push({ key: s.key, value: s.value, pct: s.pct });
    }
  });

  const width  = 900;
  const height = 360;
  const margin = { top: 18, right: 18, bottom: 10, left: 18 };

  const cellSize = 20;
  const gap      = 4;

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const blockW = cols * cellSize + (cols - 1) * gap;
  const blockH = rows * cellSize + (rows - 1) * gap;

  const startX = (width  - blockW) / 2;
  const startY = (height - blockH) / 2 - 6;

  svg.append("g")
    .selectAll("rect")
    .data(grid)
    .join("rect")
    .attr("x", (_, i) => startX + (i % cols) * (cellSize + gap))
    .attr("y", (_, i) => startY + Math.floor(i / cols) * (cellSize + gap))
    .attr("width", cellSize)
    .attr("height", cellSize)
    .attr("rx", 4)
    .attr("ry", 4)
    .attr("fill", d => TYPE_COLORS(d.key))
    .on("mousemove", (ev, d) => {
      const html =
        `<strong>${d.key}</strong><br/>` +
        `${d3.format(",")(d.value)} deaths<br/>` +
        `${Math.round(d.pct * 100)}% of ${year}`;
      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  d3.select("#waffle-year").text(year);

  // Type legend (shared helper).
  addTypeLegend(sel);
}

/* 6) Histogram — total conflict-related deaths per country (snapshot year) */
function drawHistogram(sel, data, year) {
  const rows = data.filter(d => d.year === year && d.total > 0);
  if (!rows.length) {
    alertIn(sel, `No country data for year ${year}.`);
    return;
  }

  const values = rows.map(d => d.total);
  const q99    = d3.quantile(values.slice().sort(d3.ascending), 0.99) || d3.max(values);
  const domainMax = Math.max(1, q99);

  const bin = d3.bin()
    .domain([0, domainMax])
    .thresholds(20);

  const clamped = values.map(v => Math.min(v, domainMax));
  const bins = bin(clamped);

  const width  = 900;
  const height = 360;
  const margin = { top: 10, right: 22, bottom: 72, left: 56 };

  const x = d3.scaleLinear()
    .domain([0, domainMax])
    .range([margin.left, width - margin.right]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(bins, d => d.length) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Horizontal grid.
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    )
    .selectAll("line")
    .attr("opacity", 0.35);

  // Bars.
  svg.append("g")
    .selectAll("rect")
    .data(bins)
    .join("rect")
    .attr("x", d => x(d.x0) + 1)
    .attr("y", d => y(d.length))
    .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 2))
    .attr("height", d => y(0) - y(d.length))
    .attr("fill", "#8aa6ff")
    .on("mousemove", (ev, d) => {
      const fmt = d3.format(",");
      const lo  = fmt(Math.round(d.x0));
      const hi  = fmt(Math.round(d.x1));
      const html =
        `<strong>Bin:</strong> ${lo} – ${hi}<br/>` +
        `<strong>Countries:</strong> ${d.length}`;
      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  // Axes.
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6, "~s"));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5));

  // X-axis label.
  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (margin.left + (width - margin.right)) / 2)
    .attr("y", height - margin.bottom + 48)
    .text("Total conflict-related deaths per country");

  // Inline caption note.
  d3.select(sel)
    .append("div")
    .attr("class", "caption")
    .text(`Histogram for ${year}. Values above the 99th percentile are clipped to improve readability.`);
}

/* 7) Violin plot — country-level distribution by conflict type (snapshot year) */
function drawViolin(sel, data, year) {
  const rows = data.filter(d => d.year === year && isISO3(d.code) && d.total > 0);
  if (!rows.length) {
    alertIn(sel, `No data available for ${year}.`);
    return;
  }

  const tidy = TYPE_ORDER.map(k => ({
    key: k,
    values: rows.map(r => r[k]).filter(v => v > 0)
  }));

  if (tidy.every(d => d.values.length === 0)) {
    alertIn(sel, `No positive values by type in ${year}.`);
    return;
  }

  const allVals = tidy.flatMap(d => d.values).sort(d3.ascending);
  const q99     = d3.quantile(allVals, 0.99) || d3.max(allVals) || 1;

  const width  = 900;
  const height = 400;
  const margin = { top: 10, right: 30, bottom: 90, left: 110 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleLinear()
    .domain([0, q99])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(TYPE_ORDER)
    .range([margin.top, height - margin.bottom])
    .padding(0.25);

  // Horizontal grid.
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    )
    .selectAll("line")
    .attr("opacity", 0.25);

  const bandwidth = arr => {
    const sd = d3.deviation(arr) || 1;
    const n  = Math.max(1, arr.length);
    return 1.06 * sd * Math.pow(n, -1 / 5);
  };

  const epanechnikov = k => v => {
    const u = v / k;
    return Math.abs(u) <= 1 ? 0.75 * (1 - u * u) / k : 0;
  };

  const thresholds = x.ticks(100);

  tidy.forEach(d => {
    if (!d.values.length) return;

    const vals = d.values.map(v => Math.min(v, q99));

    const h       = Math.max(0.5, bandwidth(vals));
    const kernel  = epanechnikov(h);
    const density = thresholds.map(t => [t, d3.mean(vals, v => kernel(t - v)) || 0]);

    const maxD   = d3.max(density, e => e[1]) || 1;
    const scaleW = d3.scaleLinear()
      .domain([0, maxD])
      .range([0, y.bandwidth() / 2]);

    const cy   = y(d.key) + y.bandwidth() / 2;
    const area = d3.area()
      .x(e => x(e[0]))
      .y0(e => cy + scaleW(e[1]))
      .y1(e => cy - scaleW(e[1]))
      .curve(d3.curveCatmullRom);

    svg.append("path")
      .datum(density)
      .attr("fill", TYPE_COLORS(d.key))
      .attr("opacity", 0.65)
      .attr("stroke", "#333")
      .attr("stroke-width", 0.8)
      .attr("d", area)
      .on("mousemove", ev => {
        const sValsRaw = d.values
          .slice()
          .filter(v => v > 0)
          .sort(d3.ascending);

        const q1  = d3.quantileSorted(sValsRaw, 0.25) || 0;
        const med = d3.quantileSorted(sValsRaw, 0.50) || 0;
        const q3  = d3.quantileSorted(sValsRaw, 0.75) || 0;
        const fmt = d3.format(",");

        const html =
          `<strong>${d.key}</strong><br/>` +
          `n = ${sValsRaw.length}<br/>` +
          `Q1–Median–Q3: ${fmt(Math.round(q1))} – ` +
          `${fmt(Math.round(med))} – ${fmt(Math.round(q3))}`;
        showTooltip(ev, html);
      })
      .on("mouseleave", hideTooltip);

    const sVals = vals.slice().sort(d3.ascending);
    const q1  = d3.quantileSorted(sVals, 0.25) || 0;
    const med = d3.quantileSorted(sVals, 0.50) || 0;
    const q3  = d3.quantileSorted(sVals, 0.75) || 0;

    svg.append("line")
      .attr("x1", x(q1))
      .attr("x2", x(q3))
      .attr("y1", cy)
      .attr("y2", cy)
      .attr("stroke", "#111")
      .attr("stroke-width", 2);

    svg.append("circle")
      .attr("cx", x(med))
      .attr("cy", cy)
      .attr("r", 3.2)
      .attr("fill", "#fff")
      .attr("stroke", "#111")
      .attr("stroke-width", 1);
  });

  // Axes.
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6, "~s"));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (width + margin.left) / 2)
    .attr("y", height - margin.bottom + 58)
    .attr("text-anchor", "middle")
    .text("Deaths per country");
}

/* 8) Boxplot — country-level distribution by conflict type (snapshot year) */
function drawBoxplot(sel, data, year) {
  const rows = data.filter(d => d.year === year && isISO3(d.code) && d.total > 0);
  if (!rows.length) {
    alertIn(sel, `No data available for ${year}.`);
    return;
  }

  const tidy = TYPE_ORDER.map(k => ({
    key: k,
    values: rows.map(r => r[k]).filter(v => v > 0)
  }));

  if (tidy.every(d => d.values.length === 0)) {
    alertIn(sel, `No positive values by type in ${year}.`);
    return;
  }

  const allVals = tidy.flatMap(d => d.values).sort(d3.ascending);
  const q99     = d3.quantile(allVals, 0.99) || d3.max(allVals) || 1;

  const width  = 900;
  const height = 360;
  const margin = { top: 10, right: 30, bottom: 70, left: 110 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleLinear()
    .domain([0, q99])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(TYPE_ORDER)
    .range([margin.top, height - margin.bottom])
    .padding(0.35);

  // Horizontal grid.
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    )
    .selectAll("line")
    .attr("opacity", 0.25);

  const stats = tidy.map(d => {
    const s = d.values.slice().sort(d3.ascending);
    if (!s.length) {
      return {
        key: d.key, n: 0,
        q1: 0, med: 0, q3: 0,
        low: 0, high: 0,
        outliers: []
      };
    }

    const q1  = d3.quantileSorted(s, 0.25) || 0;
    const med = d3.quantileSorted(s, 0.50) || 0;
    const q3  = d3.quantileSorted(s, 0.75) || 0;
    const iqr = q3 - q1;

    const fenceLow  = q1 - 1.5 * iqr;
    const fenceHigh = q3 + 1.5 * iqr;

    const inside   = s.filter(v => v >= fenceLow && v <= fenceHigh);
    const low      = inside.length ? d3.min(inside) : q1;
    const high     = inside.length ? d3.max(inside) : q3;
    const outliers = s.filter(v => v < fenceLow || v > fenceHigh);

    return { key: d.key, n: s.length, q1, med, q3, low, high, outliers };
  });

  const fmt = d3.format(",");

  const showSummary = (ev, d) => {
    const html =
      `<strong>${d.key}</strong><br/>` +
      `n = ${d.n}<br/>` +
      `Q1–Median–Q3: ${fmt(Math.round(d.q1))} – ` +
      `${fmt(Math.round(d.med))} – ${fmt(Math.round(d.q3))}<br/>` +
      `Whiskers: ${fmt(Math.round(d.low))} – ${fmt(Math.round(d.high))}`;
    showTooltip(ev, html);
  };

  const g = svg.append("g");
  const boxH = Math.min(28, y.bandwidth());

  // Transparent hit band for robust hover detection.
  g.selectAll("rect.hit")
    .data(stats)
    .join("rect")
    .attr("class", "hit")
    .attr("x", x(0))
    .attr("y", d => y(d.key))
    .attr("width", (width - margin.right) - x(0))
    .attr("height", y.bandwidth())
    .attr("fill", "transparent")
    .on("mousemove", showSummary)
    .on("mouseleave", hideTooltip);

  // Whiskers.
  g.selectAll("line.whisker")
    .data(stats)
    .join("line")
    .attr("class", "whisker")
    .attr("x1", d => x(Math.min(d.low, q99)))
    .attr("x2", d => x(Math.min(d.high, q99)))
    .attr("y1", d => y(d.key) + y.bandwidth() / 2)
    .attr("y2", d => y(d.key) + y.bandwidth() / 2)
    .attr("stroke", "#7c818b");

  // Whisker caps.
  g.selectAll("line.cap-low")
    .data(stats)
    .join("line")
    .attr("x1", d => x(Math.min(d.low, q99)))
    .attr("x2", d => x(Math.min(d.low, q99)))
    .attr("y1", d => y(d.key) + (y.bandwidth() - boxH) / 2)
    .attr("y2", d => y(d.key) + (y.bandwidth() + boxH) / 2)
    .attr("stroke", "#7c818b");

  g.selectAll("line.cap-high")
    .data(stats)
    .join("line")
    .attr("x1", d => x(Math.min(d.high, q99)))
    .attr("x2", d => x(Math.min(d.high, q99)))
    .attr("y1", d => y(d.key) + (y.bandwidth() - boxH) / 2)
    .attr("y2", d => y(d.key) + (y.bandwidth() + boxH) / 2)
    .attr("stroke", "#7c818b");

  // Boxes (Q1–Q3).
  g.selectAll("rect.box")
    .data(stats)
    .join("rect")
    .attr("class", "box")
    .attr("x", d => x(Math.min(d.q1, q99)))
    .attr("y", d => y(d.key) + (y.bandwidth() - boxH) / 2)
    .attr("width", d => Math.max(
      0,
      x(Math.min(d.q3, q99)) - x(Math.min(d.q1, q99))
    ))
    .attr("height", boxH)
    .attr("fill", d => TYPE_COLORS(d.key))
    .attr("fill-opacity", 0.28)
    .attr("stroke", d => d3.color(TYPE_COLORS(d.key)).darker(0.8))
    .attr("stroke-width", 1.2)
    .on("mousemove", showSummary)
    .on("mouseleave", hideTooltip);

  // Median line.
  g.selectAll("line.median")
    .data(stats)
    .join("line")
    .attr("class", "median")
    .attr("x1", d => x(Math.min(d.med, q99)))
    .attr("x2", d => x(Math.min(d.med, q99)))
    .attr("y1", d => y(d.key) + (y.bandwidth() - boxH) / 2)
    .attr("y2", d => y(d.key) + (y.bandwidth() + boxH) / 2)
    .attr("stroke", "#111")
    .attr("stroke-width", 2);

  // Outliers.
  g.append("g")
    .attr("class", "outliers")
    .selectAll("g.outlier-group")
    .data(stats)
    .join("g")
    .attr("class", "outlier-group")
    .each(function (d) {
      d3.select(this)
        .selectAll("circle")
        .data(d.outliers)
        .join("circle")
        .attr("cx", v => x(Math.min(v, q99)))
        .attr("cy", y(d.key) + y.bandwidth() / 2 +
          (Math.random() - 0.5) * (boxH * 0.6))
        .attr("r", 2.2)
        .attr("fill", "#555")
        .attr("fill-opacity", 0.5)
        .on("mousemove", (ev, v) => {
          const html =
            `<strong>${d.key}</strong><br/>Outlier: ${fmt(Math.round(v))}`;
          showTooltip(ev, html);
        })
        .on("mouseleave", hideTooltip);
    });

  // Axes.
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6, "~s"));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (width + margin.left) / 2)
    .attr("y", height - margin.bottom + 58)
    .attr("text-anchor", "middle")
    .text("Deaths per country");
}

/* 9) Time series — World totals over time */
function drawTimeSeries(sel, worldRows) {
  if (!worldRows.length) {
    alertIn(sel, "No World aggregate rows found.");
    return;
  }

  const rows = worldRows
    .slice()
    .sort((a, b) => d3.ascending(a.year, b.year));

  const years  = rows.map(d => d.year);
  const totals = rows.map(d => d.total);

  const width  = 900;
  const height = 360;
  const margin = { top: 18, right: 28, bottom: 58, left: 100 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleLinear()
    .domain(d3.extent(years))
    .range([margin.left, width - margin.right]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(totals) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  // Horizontal grid.
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    )
    .selectAll("line")
    .attr("opacity", 0.3);

  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.total))
    .curve(d3.curveMonotoneX);

  svg.append("path")
    .datum(rows)
    .attr("fill", "none")
    .attr("stroke", "#4f7df3")
    .attr("stroke-width", 2.4)
    .attr("d", line);

  const fmt = d3.format(",");

  svg.append("g")
    .selectAll("circle")
    .data(rows)
    .join("circle")
    .attr("cx", d => x(d.year))
    .attr("cy", d => y(d.total))
    .attr("r", 3)
    .attr("fill", "#4f7df3")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1)
    .on("mousemove", (ev, d) => {
      const html =
        `<strong>${d.year}</strong><br/>` +
        `${fmt(Math.round(d.total))} deaths`;
      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  // Axes.
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(8)
        .tickFormat(d3.format("d"))
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("~s")));

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (margin.left + (width - margin.right)) / 2)
    .attr("y", height - margin.bottom + 40)
    .text("Year");

  const centerY = (margin.top + (height - margin.bottom)) / 2;

  svg.append("text")
    .attr("class", "axis-label")
    .attr("transform", `translate(${margin.left - 60}, ${centerY}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .text("Conflict-related deaths (World total)");
}

/* 10) Choropleth map — total conflict-related deaths per country (snapshot year) */
function drawChoropleth(sel, worldFC, dataRows, year) {
  if (!worldFC || !Array.isArray(worldFC.features) || !worldFC.features.length) {
    alertIn(sel, "World boundaries are missing or invalid.");
    return;
  }

  const features = worldFC.features;

  const rows = dataRows.filter(d => d.year === year && isISO3(d.code));
  if (!rows.length) {
    alertIn(sel, `No country data for year ${year}.`);
    return;
  }

  const valueByISO = {};
  rows.forEach(d => {
    const iso = d.code;
    const val = +d.total;
    if (!Number.isNaN(val)) {
      valueByISO[iso] = val;
    }
  });

  const positiveValues = Object
    .values(valueByISO)
    .filter(v => v > 0);

  let maxVal = d3.max(positiveValues) || 1;
  if (maxVal < 1) {
    maxVal = 1;
  }

  const width  = 900;
  const height = 420;
  const marginBottom = 40;

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Ensure the tooltip is hidden when leaving the map container.
  d3.select(sel).on("mouseleave", hideTooltip);

  const projection = d3.geoNaturalEarth1()
    .fitSize([width, height - marginBottom - 10], worldFC);

  const path = d3.geoPath(projection);

  const color = d3.scaleSequentialLog()
    .domain([1, maxVal])
    .interpolator(d3.interpolateOrRd);

  svg.append("g")
    .selectAll("path")
    .data(features)
    .join("path")
    .attr("d", path)
    .attr("fill", d => {
      const iso = (
        d.properties.iso_a3 ||
        d.properties.ISO_A3 ||
        ""
      ).toUpperCase();

      const val = valueByISO[iso];
      return val > 0 ? color(val) : "#e5e7eb";
    })
    .attr("stroke", "#9ca3af")
    .attr("stroke-width", 0.4)
    .on("mousemove", (ev, d) => {
      const iso = (
        d.properties.iso_a3 ||
        d.properties.ISO_A3 ||
        ""
      ).toUpperCase();

      const name =
        d.properties.name ||
        d.properties.ADMIN ||
        "Unknown country";

      const val = valueByISO[iso];

      let html;
      if (val === undefined) {
        html =
          `<strong>${name}</strong><br/>` +
          `No data in this dataset in ${year}`;
      } else if (val === 0) {
        html =
          `<strong>${name}</strong><br/>` +
          `0 conflict-related deaths in ${year}`;
      } else {
        html =
          `<strong>${name}</strong><br/>` +
          `${d3.format(",")(val)} deaths in ${year}`;
      }

      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  // Continuous legend on a logarithmic scale.
  const legendWidth  = 260;
  const legendHeight = 10;

  const legendGroup = svg.append("g")
    .attr(
      "transform",
      `translate(${(width - legendWidth) / 2}, ${height - marginBottom + 12})`
    );

  const defs = svg.append("defs");
  const gradient = defs.append("linearGradient")
    .attr("id", "choropleth-gradient");

  const stops = 10;
  const logMin = Math.log(1);
  const logMax = Math.log(maxVal);

  for (let i = 0; i <= stops; i += 1) {
    const t   = i / stops;
    const val = Math.exp(logMin + t * (logMax - logMin));

    gradient.append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", color(val));
  }

  legendGroup.append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", "url(#choropleth-gradient)");

  const legendScale = d3.scaleLog()
    .domain([1, maxVal])
    .range([0, legendWidth]);

  legendGroup.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0, ${legendHeight})`)
    .call(d3.axisBottom(legendScale).ticks(4, "~s"));

  legendGroup.append("text")
    .attr("x", legendWidth / 2)
    .attr("y", -6)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .attr("fill", "#555")
    .text("Total conflict-related deaths (log scale)");
}
