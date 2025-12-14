/*******************************************************
 * Visualizing Conflict and Human Suffering — JS bundle
 * Dataset: UCDP via Our World in Data
 *
 * Section 1 — Comparing categories
 *  1) Top-10 barchart (absolute)            -> #bar-top10
 *  2) Grouped barchart (selected countries) -> #grouped
 *  3) Heatmap (World totals, type × year)   -> #heatmap
 *  4) 100% stacked barchart (World shares)  -> #stack100
 *  5) Waffle chart (World composition Y)    -> #waffle
 *
 * Section 2 — Distributions (snapshot year)
 *  6) Histogram (country totals)            -> #histogram
 *  7) Violin plot (by conflict type)        -> #violin
 *  8) Boxplot (by conflict type)            -> #boxplot
 *
 * Section 3 — Temporal patterns
 *  9) Line chart (World totals over time)   -> #timeseries
 *
 * Section 4 — Spatial patterns
 * 10) Choropleth map (country totals, snapshot year)              -> #map-choropleth
 * 11) Proportional symbol map (country totals as circles, snapshot year) -> #map-symbol
 * 12) Contour / isopleth map (smoothed intensity surface, snapshot year) -> #map-contour
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
  "#map-choropleth",
  "#map-symbol",
  "#map-contour",
  "#sankey",
  "#network"
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
  d3.select("#year-sankey").text(SNAPSHOT_YEAR);
  d3.select("#year-network").text(SNAPSHOT_YEAR);

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
  
  try {
    drawProportionalMap("#map-symbol", worldFC, countries, SNAPSHOT_YEAR);
  } catch (e) {
    console.error("Failed to render proportional symbol map:", e);
    alertIn("#map-symbol", "Could not render proportional symbol map (GeoJSON error).");
  }

  try {
    drawContourMap("#map-contour", worldFC, countries, SNAPSHOT_YEAR);
  } catch (e) {
    console.error("Failed to render contour map:", e);
    alertIn("#map-contour", "Could not render contour map (GeoJSON error).");
  }

  /* ---- Section 5: Connection visualization ---- */
  drawSankey("#sankey", countries, SNAPSHOT_YEAR);
  drawCountrySimilarityNetwork("#network", countries, SNAPSHOT_YEAR);
  
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
    .domain([0, Math.log10(max + 1)]);

  svg.append("g")
    .selectAll("rect")
    .data(cells)
    .join("rect")
    .attr("x", d => x(d.col))
    .attr("y", d => y(d.row))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("fill", d => color(Math.log10(d.value + 1)))
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

  // Posiziona la leggenda sotto l'asse X, in basso a destra
  const legendX = width - legendW - 24;
  const legendY = height - margin.bottom + 18; // sotto l'asse

  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", "hm-grad");

  grad.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", color(0));

  grad.append("stop")
    .attr("offset", "100%")
    .attr("stop-color", color(max));

  // Barra gradiente
  svg.append("rect")
    .attr("x", legendX)
    .attr("y", legendY)
    .attr("width", legendW)
    .attr("height", legendH)
    .attr("fill", "url(#hm-grad)");

  // Scala log per i tick della leggenda
  const s = d3.scaleLog()
    .domain([1, max])
    .range([legendX, legendX + legendW]);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${legendY + legendH})`)
    .call(d3.axisBottom(s).ticks(3, "~s"));

  // Etichetta della leggenda
  svg.append("text")
    .attr("x", legendX + legendW / 2)
    .attr("y", legendY + legendH + 24)  // sotto la barra
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

/* 10) Choropleth map — conflict-related deaths per country (snapshot year) */
function drawChoropleth(sel, worldFC, dataRows, year) {
  // 0) Validate GeoJSON input
  if (!worldFC || !Array.isArray(worldFC.features) || !worldFC.features.length) {
    alertIn(sel, "World boundaries are missing or invalid.");
    return;
  }
  const features = worldFC.features;

  // 1) Filter data for the selected year and build an ISO3 -> value lookup
  const rows = dataRows.filter(d => d.year === year && isISO3(d.code));
  if (!rows.length) {
    alertIn(sel, `No country data for year ${year}.`);
    return;
  }

  const valueByISO = {};
  rows.forEach(d => {
    const iso = d.code;
    const val = +d.total || 0;
    if (!Number.isNaN(val) && val > 0) {
      valueByISO[iso] = val;
    }
  });

  const positiveValues = Object.values(valueByISO).filter(v => v > 0);
  if (!positiveValues.length) {
    alertIn(sel, `No positive country totals for ${year}.`);
    return;
  }

  const sortedVals = positiveValues.slice().sort(d3.ascending);
  const p99 = d3.quantileSorted(sortedVals, 0.99) || d3.max(sortedVals);
  const domainMax = Math.max(1, p99);

  const width  = 900;
  const height = 420;
  const marginBottom = 56;

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Hide tooltip when leaving the map container
  d3.select(sel).on("mouseleave", hideTooltip);

  // 2) Projection and path generator
  const projection = d3.geoNaturalEarth1()
    .fitSize([width, height - marginBottom - 10], worldFC);

  const path = d3.geoPath(projection);

  // 3) Colour scale (sequential)
  const color = d3.scaleSequential(d3.interpolateOrRd)
    .domain([0, domainMax]); 
  
  // Helper: robust ISO3 extraction from GeoJSON properties
  const getISO3 = feat => {
    const p = feat.properties || {};
    return (p.iso_a3 || p.ISO_A3 || "").toUpperCase();
  };

  // 4) Draw countries
  const fmt = d3.format(",");

  svg.append("g")
    .selectAll("path")
    .data(features)
    .join("path")
      .attr("d", path)
      .attr("stroke", "#9ca3af")
      .attr("stroke-width", 0.4)
      .attr("fill", d => {
        const iso = getISO3(d);
        const v   = valueByISO[iso];
        return v && v > 0 ? color(Math.min(v, domainMax)) : "#e5e7eb"; // light grey for “no data”
      })
      .on("mousemove", (ev, d) => {
        const iso = getISO3(d);
        const v   = valueByISO[iso];
        const name =
          d.properties?.name ||
          d.properties?.ADMIN ||
          iso ||
          "Unknown";

        let html;
        if (v && v > 0) {
          html =
            `<strong>${name}</strong><br/>` +
            `${fmt(v)} deaths in ${year}`;
        } else {
          html =
            `<strong>${name}</strong><br/>` +
            `No UCDP country-level deaths recorded in ${year}.`;
        }
        showTooltip(ev, html);
      })
      .on("mouseleave", hideTooltip);

  // 5) Continuous legend (bottom right)
  const legendWidth  = 220;
  const legendHeight = 10;
  const legendX = width - legendWidth - 24;
  const legendY = height - marginBottom - 26;
  
  const defs = svg.append("defs");
  const gradient = defs.append("linearGradient")
    .attr("id", "choropleth-gradient");

  gradient.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", color(0));

  gradient.append("stop")
    .attr("offset", "100%")
    .attr("stop-color", color(domainMax));

  // Gradient bar
  svg.append("rect")
    .attr("x", legendX)
    .attr("y", legendY)
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", "url(#choropleth-gradient)");

  // Legend axis (linear scale)
  const legendScale = d3.scaleLinear()
    .domain([0, domainMax])
    .range([legendX, legendX + legendWidth]);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0, ${legendY + legendHeight})`)
    .call(
      d3.axisBottom(legendScale)
        .ticks(4, "~s")
    );

  svg.append("text")
    .attr("x", legendX + legendWidth / 2)
    .attr("y", legendY - 8)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .attr("fill", "#555")
    .text("Conflict-related deaths (country total)");
}

/* 11) Proportional symbol map — country totals as circles (snapshot year)*/
function drawProportionalMap(sel, worldFC, dataRows, year) {
  // 0) Validate GeoJSON input
  if (!worldFC || !Array.isArray(worldFC.features) || !worldFC.features.length) {
    alertIn(sel, "World boundaries are missing or invalid.");
    return;
  }
  const features = worldFC.features;

  // 1) Filter data for the selected year and build an ISO3 -> value lookup
  const rows = dataRows.filter(d => d.year === year && isISO3(d.code));
  if (!rows.length) {
    alertIn(sel, `No country data for year ${year}.`);
    return;
  }

  const valueByISO = {};
  rows.forEach(d => {
    const iso = d.code;
    const val = +d.total;
    if (!Number.isNaN(val) && val > 0) {
      valueByISO[iso] = val;
    }
  });

  const positiveValues = Object.values(valueByISO).filter(v => v > 0);
  if (!positiveValues.length) {
    alertIn(sel, `No positive country totals for ${year}.`);
    return;
  }
  const maxVal = d3.max(positiveValues) || 1;

  const width  = 900;
  const height = 420;
  const marginBottom = 56;

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Hide tooltip when leaving the map container
  d3.select(sel).on("mouseleave", hideTooltip);

  // 2) Projection and path generator (kept consistent with choropleth)
  const projection = d3.geoNaturalEarth1()
    .fitSize([width, height - marginBottom - 10], worldFC);

  const path = d3.geoPath(projection);

  // 3) Basemap in a light neutral style
  svg.append("g")
    .selectAll("path")
    .data(features)
    .join("path")
      .attr("d", path)
      .attr("class", "symbol-country");

  // 4) Circle radius (square-root scale so that area ∝ value)
  const radius = d3.scaleSqrt()
    .domain([1, maxVal])
    .range([2, 22]);

  // Helper: robust ISO3 extraction from GeoJSON properties
  const getISO3 = feat => {
    const p = feat.properties || {};
    return (p.iso_a3 || p.ISO_A3 || "").toUpperCase();
  };

  // 5) Build list of features with both geometry and data (+ centroids)
  const symbolFeatures = features
    .map(f => {
      const iso = getISO3(f);
      const val = valueByISO[iso];
      if (!val || val <= 0) return null;

      const c  = path.centroid(f);
      const cx = c[0];
      const cy = c[1];
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

      return { feature: f, iso, value: val, cx, cy };
    })
    .filter(d => d !== null)
    // Larger circles first so that smaller ones remain visible on top
    .sort((a, b) => d3.descending(a.value, b.value));

  if (!symbolFeatures.length) {
    alertIn(sel, `No countries with valid geometries and data in ${year}.`);
    return;
  }

  const fmt = d3.format(",");

  // 6) Draw circles
  svg.append("g")
    .selectAll("circle")
    .data(symbolFeatures)
    .join("circle")
      .attr("class", "symbol-circle")
      .attr("cx", d => d.cx)
      .attr("cy", d => d.cy)
      .attr("r",  d => radius(d.value))
      .on("mousemove", (ev, d) => {
        const name =
          d.feature.properties?.name ||
          d.feature.properties?.ADMIN ||
          d.iso;

        const html =
          `<strong>${name}</strong><br/>` +
          `${fmt(d.value)} deaths in ${year}`;
        showTooltip(ev, html);
      })
      .on("mouseleave", hideTooltip);

  // 7) Simple bubble legend (bottom-right corner)
  // Use "nice" rounded values to make the legend easier to read
  const niceMax = d3.tickStep(0, maxVal, 1);   // e.g. 80k for 75k
  let legendVals = [niceMax / 4, niceMax / 2, niceMax]
    .map(v => Math.round(v))
    .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);

  if (legendVals.length) {
    const legend = svg.append("g")
      .attr("class", "symbol-legend")
      .attr("transform", `translate(${width - 140}, ${height - marginBottom + 10})`);

    const lineHeight = 26;

    legendVals.slice().reverse().forEach((v, i) => {
      const r  = radius(v);
      const cy = -i * lineHeight - r;

      legend.append("circle")
        .attr("cx", 0)
        .attr("cy", cy)
        .attr("r",  r)
        .attr("class", "symbol-circle");

      legend.append("text")
        .attr("x", r + 8)
        .attr("y", cy + 4)
        .text(fmt(v));
    });

    legend.append("text")
      .attr("x", 0)
      .attr("y", -legendVals.length * lineHeight - 6)
      .attr("font-size", 12)
      .attr("fill", "#555")
      .text("Deaths (circle area)");
  }
}

/* 12) Contour / isopleth map — smoothed conflict intensity surface (snapshot year)*/
function drawContourMap(sel, worldFC, dataRows, year) {
  // 0) Basic sanity check for the world GeoJSON
  if (!worldFC || !Array.isArray(worldFC.features) || !worldFC.features.length) {
    alertIn(sel, "World boundaries are missing or invalid.");
    return;
  }
  const features = worldFC.features;

  // 1) Filter the input table for the selected year and build ISO3 -> total lookup
  const rows = dataRows.filter(d => d.year === year && isISO3(d.code));
  if (!rows.length) {
    alertIn(sel, `No country data for year ${year}.`);
    return;
  }

  const valueByISO = {};
  rows.forEach(d => {
    const iso = d.code;
    const val = +d.total;
    // We only care about strictly positive totals
    if (!Number.isNaN(val) && val > 0) {
      valueByISO[iso] = val;
    }
  });

  const positiveValues = Object.values(valueByISO).filter(v => v > 0);
  if (!positiveValues.length) {
    alertIn(sel, `No positive country totals for ${year}.`);
    return;
  }

  const width  = 900;
  const height = 420;
  const marginBottom = 56;

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Make sure the tooltip disappears when leaving the whole container
  d3.select(sel).on("mouseleave", hideTooltip);

  // 2) Map projection and path generator, kept consistent with the other maps
  const projection = d3.geoNaturalEarth1()
    .fitSize([width, height - marginBottom - 10], worldFC);

  const geoPath = d3.geoPath(projection);

  // Light gray basemap for geographic context
  svg.append("g")
    .selectAll("path")
    .data(features)
    .join("path")
      .attr("d", geoPath)
      .attr("fill", "#f3f4f6")
      .attr("stroke", "#d1d5db")
      .attr("stroke-width", 0.4);

  // Helper: robust ISO3 extraction from different possible property names
  const getISO3 = feat => {
    const p = feat.properties || {};
    return (p.iso_a3 || p.ISO_A3 || "").toUpperCase();
  };

  // 3) Build one point per country centroid, weighted by conflict deaths
  //    We log-transform the totals to avoid a few large countries dominating everything.
  const points = [];
  features.forEach(f => {
    const iso = getISO3(f);
    const val = valueByISO[iso];
    if (!val || val <= 0) return;

    const c = geoPath.centroid(f);
    const cx = c[0];
    const cy = c[1];
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

    points.push({
      x: cx,
      y: cy,
      weight: Math.log10(val + 1)   // smooth out very large differences
    });
  });

  if (!points.length) {
    alertIn(sel, `No countries with valid geometries and data in ${year}.`);
    return;
  }

  // 4) Estimate a smooth density surface and extract contour bands (isopleths)
  const contours = d3.contourDensity()
    .x(d => d.x)
    .y(d => d.y)
    .weight(d => d.weight)
    .size([width, height - marginBottom - 10])
    .bandwidth(40)   // higher = smoother intensity field
    .thresholds(10)  // number of contour levels
    (points);

  const valuesExtent = d3.extent(contours, d => d.value);
  let minD = valuesExtent[0] ?? 0;
  let maxD = valuesExtent[1] ?? 1;

  // Guard against a degenerate case where all density values collapse to the same number
  if (maxD - minD < 1e-6) {
    maxD = minD + 1e-6;
  }

  const color = d3.scaleSequential(d3.interpolateOrRd)
    .domain([minD, maxD]);

  // We use a plain screen-space path generator for the contour polygons
  const contourPath = d3.geoPath();

  // 4b) Draw the filled contour bands
  const contourGroup = svg.append("g")
    .attr("class", "contours");

  contourGroup
    .selectAll("path")
    .data(contours)
    .join("path")
      .attr("d", contourPath)
      .attr("fill", d => color(d.value))
      // Thin white stroke to visually separate the bands
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.5)
      // Opacity increases with intensity: far areas are light, the core is strong
      .attr("opacity", d => {
        let rel = (d.value - minD) / (maxD - minD);
        if (!Number.isFinite(rel)) rel = 0;
        rel = Math.max(0, Math.min(1, rel));   // clamp to [0, 1]
        return 0.25 + 0.55 * rel;             // 0.25 (lowest) → 0.80 (highest)
      });

  // 4c) Tooltip: show a clean percentage of the maximum intensity.
  //     If the value is not meaningful (NaN / out of range), we simply hide the tooltip.
  contourGroup.selectAll("path")
    .on("mousemove", (ev, d) => {
      let rel = (d.value - minD) / (maxD - minD);
      if (!Number.isFinite(rel)) {
        hideTooltip();
        return;
      }
      rel = Math.max(0, Math.min(1, rel));
      const percent = (rel * 100).toFixed(0);

      const html =
        `<strong>Relative conflict intensity</strong><br/>` +
        `Isopleth level: ${percent}% of max (smoothed)`;
      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  // 5) Simple horizontal legend in the bottom-right corner, expressed in 0–100%
  const legendWidth  = 200;
  const legendHeight = 10;
  const legendX = width - legendWidth - 24;
  const legendY = height - marginBottom - 20;

  const defs = svg.append("defs");
  const gradient = defs.append("linearGradient")
    .attr("id", "contour-gradient");

  gradient.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", color(minD));

  gradient.append("stop")
    .attr("offset", "100%")
    .attr("stop-color", color(maxD));

  svg.append("rect")
    .attr("x", legendX)
    .attr("y", legendY)
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", "url(#contour-gradient)");

  const legendScale = d3.scaleLinear()
    .domain([0, 1])  // 0–100% of the maximum intensity
    .range([legendX, legendX + legendWidth]);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0, ${legendY + legendHeight})`)
    .call(
      d3.axisBottom(legendScale)
        .ticks(3)
        .tickFormat(d => `${Math.round(d * 100)}%`)
    );

  svg.append("text")
    .attr("x", legendX + legendWidth / 2)
    .attr("y", legendY - 6)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .attr("fill", "#555")
    .text("Smoothed conflict intensity (relative to max)");
}

/* ===================== CONNECTION VIS (Sankey + Network) ===================== */

/**
 * Utility: get top N countries by total for a given year.
 */
function topCountriesByTotal(data, year, N = 12) {
  return data
    .filter(d => d.year === year && d.total > 0)
    .slice()
    .sort((a, b) => d3.descending(a.total, b.total))
    .slice(0, N);
}

/**
 * Utility: safe numeric vector for a country (by conflict type).
 */
function typeVector(d) {
  return TYPE_ORDER.map(k => Math.max(0, +d[k] || 0));
}

/**
 * Utility: cosine similarity between two non-negative vectors.
 */
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* 13) Sankey diagram — flows Type -> Country (snapshot year) */
function drawSankey(sel, data, year) {
  // d3-sankey must be loaded separately
  if (typeof d3.sankey !== "function") {
    alertIn(sel, "Sankey requires d3-sankey. Include it in your HTML (d3-sankey script).");
    return;
  }

  // ======================
  // Settings (tweak here)
  // ======================
  const TOP_N = 10;               // Top N countries + Other countries
  const MIN_FLOW = 0;             // keep all positive flows
  const HEIGHT = 540;             // more vertical space -> less crowding
  const MARGIN = { top: 14, right: 24, bottom: 14, left: 24 };
  const NODE_WIDTH = 16;
  const NODE_PADDING = 18;
  const LABEL_MAX_CHARS = 18;     // truncate long labels (tooltip always shows full)
  const LINK_OPACITY_DEFAULT = 0.35;
  const LINK_OPACITY_DIM = 0.06;
  const LINK_OPACITY_FOCUS = 0.92;

  // ======================
  // Helpers: naming/labels
  // ======================
  const COUNTRY_ALIASES = new Map([
    ["Democratic Republic of Congo", "DR Congo"],
    ["Democratic Republic of the Congo", "DR Congo"],
    ["Congo, Dem. Rep.", "DR Congo"],
    ["Central African Republic", "CAR"],
    ["United States", "USA"],
    ["United Kingdom", "UK"],
    ["Russian Federation", "Russia"],
    ["Iran (Islamic Republic of)", "Iran"],
    ["Syrian Arab Republic", "Syria"],
    ["Venezuela (Bolivarian Republic of)", "Venezuela"],
    ["Bolivia (Plurinational State of)", "Bolivia"],
    ["Tanzania, United Republic of", "Tanzania"],
    ["Viet Nam", "Vietnam"],
    ["Lao People's Democratic Republic", "Laos"],
    ["Myanmar (Burma)", "Myanmar"]
  ]);

  function prettyCountryName(name) {
    return COUNTRY_ALIASES.get(name) || name;
  }

  function truncateLabel(s, maxChars = LABEL_MAX_CHARS) {
    const str = String(s ?? "");
    if (str.length <= maxChars) return str;
    return str.slice(0, Math.max(1, maxChars - 1)) + "…";
  }

  function fmtInt(x) {
    return d3.format(",")(Math.round(+x || 0));
  }

  // ======================
  // Prepare year data
  // ======================
  const yearRows = data.filter(d => d.year === year && d.total > 0);
  if (!yearRows.length) {
    alertIn(sel, `No country data for year ${year}.`);
    return;
  }

  // Top N countries by total
  const top = yearRows
    .slice()
    .sort((a, b) => d3.descending(a.total, b.total))
    .slice(0, TOP_N);

  const topNames = new Set(top.map(d => d.entity));
  const others = yearRows.filter(d => !topNames.has(d.entity));

  // Aggregate "Other countries" by type
  const otherAgg = { entity: "Other countries" };
  TYPE_ORDER.forEach(t => {
    otherAgg[t] = d3.sum(others, d => Math.max(0, +d[t] || 0));
  });
  otherAgg.total = d3.sum(TYPE_ORDER, t => otherAgg[t] || 0);
  const includeOther = otherAgg.total > 0;

  // ======================
  // Build nodes
  // ======================
  const typeNodes = TYPE_ORDER.map((t, i) => ({
    id: `type:${t}`,
    label: t,
    kind: "type",
    sortKey: i
  }));

  // countries sorted by total desc
  const topSorted = top
    .slice()
    .sort((a, b) => d3.descending(a.total, b.total));

  const countryNodes = topSorted.map((d, i) => ({
    id: `c:${d.entity}`,
    label: prettyCountryName(d.entity),
    fullLabel: d.entity,                 // original (for tooltip)
    kind: "country",
    total: d.total,
    sortKey: i,
    isOther: false
  }));

  if (includeOther) {
    countryNodes.push({
      id: "c:Other countries",
      label: "Other countries",
      fullLabel: "Other countries (aggregated)",
      kind: "country",
      total: otherAgg.total,
      sortKey: 999999,                   // always last
      isOther: true
    });
  }

  const nodes = [...typeNodes, ...countryNodes];

  // ======================
  // Build links
  // ======================
  const links = [];

  // Top countries links
  topSorted.forEach(d => {
    TYPE_ORDER.forEach(t => {
      const v = Math.max(0, +d[t] || 0);
      if (v > MIN_FLOW) {
        links.push({
          source: `type:${t}`,
          target: `c:${d.entity}`,
          value: v,
          type: t,
          countryFull: d.entity,
          countryPretty: prettyCountryName(d.entity),
          isOther: false
        });
      }
    });
  });

  // Other aggregated links
  if (includeOther) {
    TYPE_ORDER.forEach(t => {
      const v = Math.max(0, +otherAgg[t] || 0);
      if (v > MIN_FLOW) {
        links.push({
          source: `type:${t}`,
          target: "c:Other countries",
          value: v,
          type: t,
          countryFull: "Other countries (aggregated)",
          countryPretty: "Other countries",
          isOther: true
        });
      }
    });
  }

  if (!links.length) {
    alertIn(sel, `No positive flows for ${year}.`);
    return;
  }

  // ======================
  // Responsive width
  // ======================
  const container = d3.select(sel);
  container.html(""); // clear

  const w = Math.floor(container.node().getBoundingClientRect().width || 900);
  const WIDTH = Math.max(760, w);

  const svg = container.append("svg")
    .attr("width", WIDTH)
    .attr("height", HEIGHT);

  d3.select(sel).on("mouseleave", hideTooltip);

  // ======================
  // Sankey layout (+ sorting!)
  // ======================
  const sankey = d3.sankey()
    .nodeId(d => d.id)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    .extent([[MARGIN.left, MARGIN.top], [WIDTH - MARGIN.right, HEIGHT - MARGIN.bottom]])
    .nodeSort((a, b) => {
      // Keep types ordered by TYPE_ORDER (top->bottom)
      if (a.kind === "type" && b.kind === "type") return d3.ascending(a.sortKey, b.sortKey);

      // Keep countries ordered by total desc; Other always last via huge sortKey
      if (a.kind === "country" && b.kind === "country") {
        // primary: sortKey; (topSorted gives sortKey by rank)
        return d3.ascending(a.sortKey, b.sortKey);
      }

      // If mixing kinds in same column (shouldn't happen): keep types before countries
      return (a.kind === "type" ? -1 : 1);
    });

  // sankey mutates input => clone
  const graph = sankey({
    nodes: nodes.map(d => ({ ...d })),
    links: links.map(d => ({ ...d }))
  });

  // ======================
  // Hover highlight helpers
  // ======================
  function resetHighlight() {
    linkSel
      .attr("stroke-opacity", LINK_OPACITY_DEFAULT)
      .attr("stroke-width", d => Math.max(1, d.width));
    nodeRects
      .attr("opacity", d => (d.kind === "type" ? 0.86 : 0.72));
  }

  function focusLinks(predicate) {
    linkSel
      .attr("stroke-opacity", d => (predicate(d) ? LINK_OPACITY_FOCUS : LINK_OPACITY_DIM))
      .attr("stroke-width", d => (predicate(d) ? Math.max(1.6, d.width + 0.6) : Math.max(1, d.width)));
  }

  function focusNode(n) {
    nodeRects
      .attr("opacity", d => (d.id === n.id ? 1 : (d.kind === "type" ? 0.25 : 0.2)));
    focusLinks(d => d.source.id === n.id || d.target.id === n.id);
  }

  // ======================
  // Draw links
  // ======================
  const linkSel = svg.append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(graph.links)
    .join("path")
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", d => TYPE_COLORS(d.type))
    .attr("stroke-opacity", LINK_OPACITY_DEFAULT)
    .attr("stroke-width", d => Math.max(1, d.width))
    .style("mix-blend-mode", "multiply")
    .on("mouseenter", (ev, d) => {
      focusLinks(x => x === d);
      const toName = d.isOther ? "Other countries (aggregated)" : d.countryFull;
      const html =
        `<strong>${d.type}</strong> → <strong>${toName}</strong><br/>` +
        `${fmtInt(d.value)} deaths (${year})`;
      showTooltip(ev, html);
    })
    .on("mousemove", (ev, d) => {
      const toName = d.isOther ? "Other countries (aggregated)" : d.countryFull;
      const html =
        `<strong>${d.type}</strong> → <strong>${toName}</strong><br/>` +
        `${fmtInt(d.value)} deaths (${year})`;
      showTooltip(ev, html);
    })
    .on("mouseleave", () => {
      hideTooltip();
      resetHighlight();
    });

  // ======================
  // Draw nodes
  // ======================
  const nodeG = svg.append("g")
    .selectAll("g")
    .data(graph.nodes)
    .join("g");

  const nodeRects = nodeG.append("rect")
    .attr("x", d => d.x0)
    .attr("y", d => d.y0)
    .attr("height", d => Math.max(1, d.y1 - d.y0))
    .attr("width", d => d.x1 - d.x0)
    .attr("rx", 3)
    .attr("fill", d => (d.kind === "type" ? TYPE_COLORS(d.label) : (d.isOther ? "#6b7280" : "#9ca3af")))
    .attr("opacity", d => (d.kind === "type" ? 0.86 : 0.72))
    .on("mouseenter", (ev, d) => {
      focusNode(d);

      const total = d.value || 0;
      const full = d.kind === "country"
        ? (d.isOther ? "Other countries (aggregated)" : (d.fullLabel || d.label))
        : d.label;

      const html =
        `<strong>${full}</strong><br/>` +
        `Total flow: ${fmtInt(total)} (${year})`;
      showTooltip(ev, html);
    })
    .on("mousemove", (ev, d) => {
      const total = d.value || 0;
      const full = d.kind === "country"
        ? (d.isOther ? "Other countries (aggregated)" : (d.fullLabel || d.label))
        : d.label;

      const html =
        `<strong>${full}</strong><br/>` +
        `Total flow: ${fmtInt(total)} (${year})`;
      showTooltip(ev, html);
    })
    .on("mouseleave", () => {
      hideTooltip();
      resetHighlight();
    });

  // ======================
  // Labels (truncated, tooltip keeps full)
  // ======================
  nodeG.append("text")
    .attr("x", d => (d.x0 < WIDTH / 2 ? d.x1 + 6 : d.x0 - 6))
    .attr("y", d => (d.y0 + d.y1) / 2)
    .attr("dy", "0.32em")
    .attr("text-anchor", d => (d.x0 < WIDTH / 2 ? "start" : "end"))
    .attr("font-size", 12)
    .attr("fill", "#111827")
    .text(d => truncateLabel(d.label))
    .append("title")
    .text(d => {
      if (d.kind === "country") {
        return d.isOther ? "Other countries (aggregated)" : (d.fullLabel || d.label);
      }
      return d.label;
    });

  // Caption
  container.append("div")
    .attr("class", "caption")
    .text(`Sankey (Top ${TOP_N} countries + Other countries) — link width encodes deaths (flow) in ${year}.`);
}

/* 14) Network — similarity between countries (composition by type, snapshot year) */
function drawNetwork(sel, data, year) {
  const TOP_N = 18;         // number of nodes
  const SIM_THRESHOLD = 0.65; // minimum similarity
  const TOP_K = 3;          // keep only top-K links per node (reduces hairball)

  const rows = topCountriesByTotal(data, year, TOP_N);
  if (!rows.length) {
    alertIn(sel, `No country data for year ${year}.`);
    return;
  }

  // ---- Build nodes
  const nodes = rows.map(d => ({
    id: d.entity,
    label: d.entity,
    total: +d.total || 0,
    vec: typeVector(d),
    // pin state (drag)
    fx: null,
    fy: null
  }));

  // helper maps
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // ---- Build all pairwise links with cosine similarity
  const allLinks = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i], b = nodes[j];
      const sim = cosineSim(a.vec, b.vec);
      if (sim >= SIM_THRESHOLD) {
        allLinks.push({ source: a.id, target: b.id, sim });
      }
    }
  }

  if (!allLinks.length) {
    alertIn(sel, `No links above similarity threshold (${SIM_THRESHOLD}) in ${year}.`);
    return;
  }

  // ---- Keep top-K links per node (by similarity)
  const linksByNode = new Map(nodes.map(n => [n.id, []]));
  allLinks.forEach(l => {
    linksByNode.get(l.source).push(l);
    linksByNode.get(l.target).push(l);
  });

  const kept = new Set();
  linksByNode.forEach(list => {
    list
      .slice()
      .sort((a, b) => d3.descending(a.sim, b.sim))
      .slice(0, TOP_K)
      .forEach(l => {
        // undirected key
        const key = l.source < l.target ? `${l.source}__${l.target}` : `${l.target}__${l.source}`;
        kept.add(key);
      });
  });

  const links = allLinks.filter(l => {
    const key = l.source < l.target ? `${l.source}__${l.target}` : `${l.target}__${l.source}`;
    return kept.has(key);
  });

  // ---- Sizing
  const width = 900;
  const height = 430;
  const margin = { top: 10, right: 10, bottom: 10, left: 10 };

  const r = d3.scaleSqrt()
    .domain([0, d3.max(nodes, d => d.total) || 1])
    .range([5, 22]);

  const strokeW = d3.scaleLinear()
    .domain(d3.extent(links, d => d.sim))
    .range([1.2, 4.0]);

  // ---- Container
  const root = d3.select(sel).html("")
    .style("position", "relative");

  // small reset button (no CSS needed)
  const btn = root.append("button")
    .text("Reset layout")
    .style("position", "absolute")
    .style("right", "10px")
    .style("top", "10px")
    .style("z-index", 2)
    .style("padding", "6px 10px")
    .style("border-radius", "8px")
    .style("border", "1px solid #e5e7eb")
    .style("background", "white")
    .style("cursor", "pointer");

  const svg = root.append("svg")
    .attr("width", width)
    .attr("height", height);

  d3.select(sel).on("mouseleave", hideTooltip);

  // Zoom/Pan
  const gZoom = svg.append("g");
  svg.call(
    d3.zoom()
      .scaleExtent([0.6, 2.5])
      .on("zoom", (ev) => gZoom.attr("transform", ev.transform))
  );

  // Background (so you can drag on empty space)
  gZoom.append("rect")
    .attr("x", 0).attr("y", 0)
    .attr("width", width).attr("height", height)
    .attr("fill", "transparent");

  const g = gZoom.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // ---- Simulation
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links)
      .id(d => d.id)
      .distance(d => 220 - 160 * d.sim)  // higher sim = closer
      .strength(d => 0.25 + 0.55 * d.sim)
    )
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(innerW / 2, innerH / 2))
    .force("collide", d3.forceCollide(d => r(d.total) + 4).iterations(2))
    // keep nodes inside box (soft)
    .force("x", d3.forceX(innerW / 2).strength(0.05))
    .force("y", d3.forceY(innerH / 2).strength(0.05));

  // ---- Draw links
  const link = g.append("g")
    .attr("stroke", "#9ca3af")
    .attr("stroke-opacity", 0.65)
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", d => strokeW(d.sim));

  // ---- Draw nodes
  const node = g.append("g")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", d => r(d.total))
    .attr("fill", "#3b82f6")
    .attr("fill-opacity", 0.75)
    .attr("stroke", "white")
    .attr("stroke-width", 1.5)
    .style("cursor", "grab");

  // ---- Labels (with outline for readability)
  const label = g.append("g")
    .selectAll("text")
    .data(nodes)
    .join("text")
    .text(d => d.label)
    .attr("font-size", 11)
    .attr("fill", "#111827")
    .attr("paint-order", "stroke")
    .attr("stroke", "white")
    .attr("stroke-width", 3)
    .attr("stroke-linejoin", "round")
    .style("pointer-events", "none");

  // ---- Hover highlight (neighbors)
  const neighbor = new Map();
  links.forEach(l => {
    const a = typeof l.source === "string" ? l.source : l.source.id;
    const b = typeof l.target === "string" ? l.target : l.target.id;
    neighbor.set(`${a}__${b}`, true);
    neighbor.set(`${b}__${a}`, true);
  });
  const isNeighbor = (a, b) => neighbor.get(`${a.id}__${b.id}`) || a.id === b.id;

  function focusNode(d) {
    node.attr("fill-opacity", n => isNeighbor(d, n) ? 0.9 : 0.12)
        .attr("stroke-opacity", n => isNeighbor(d, n) ? 1 : 0.15);

    label.attr("opacity", n => isNeighbor(d, n) ? 1 : 0.15);

    link.attr("stroke-opacity", l => {
          const s = typeof l.source === "string" ? l.source : l.source.id;
          const t = typeof l.target === "string" ? l.target : l.target.id;
          return (s === d.id || t === d.id) ? 0.95 : 0.08;
        })
        .attr("stroke-width", l => {
          const s = typeof l.source === "string" ? l.source : l.source.id;
          const t = typeof l.target === "string" ? l.target : l.target.id;
          return (s === d.id || t === d.id) ? Math.max(2.4, strokeW(l.sim)) : strokeW(l.sim);
        });
  }

  function resetFocus() {
    node.attr("fill-opacity", 0.75).attr("stroke-opacity", 1);
    label.attr("opacity", 1);
    link.attr("stroke-opacity", 0.65).attr("stroke-width", d => strokeW(d.sim));
  }

  // ---- Tooltip for nodes
  node.on("mousemove", (ev, d) => {
      const parts = TYPE_ORDER
        .map(k => `${k}: ${d3.format(",")(Math.round(d.vec[TYPE_ORDER.indexOf(k)] || 0))}`)
        .join(", ");

      const html =
        `<strong>${d.label}</strong><br/>` +
        `Total deaths: ${d3.format(",")(Math.round(d.total))} (${year})<br/>` +
        `<span style="opacity:.85">Vector: [${parts}]</span>`;
      showTooltip(ev, html);
      focusNode(d);
    })
    .on("mouseleave", () => {
      hideTooltip();
      resetFocus();
    })
    .on("dblclick", (ev, d) => {
      // unpin
      d.fx = null;
      d.fy = null;
      sim.alpha(0.6).restart();
    });

  // ---- Tooltip for links
  link.on("mousemove", (ev, d) => {
      const s = typeof d.source === "string" ? d.source : d.source.id;
      const t = typeof d.target === "string" ? d.target : d.target.id;
      const html =
        `<strong>${s}</strong> ↔ <strong>${t}</strong><br/>` +
        `Cosine similarity: ${d3.format(".2f")(d.sim)}`;
      showTooltip(ev, html);
    })
    .on("mouseleave", hideTooltip);

  // ---- Drag behavior: pin on drag end
  const drag = d3.drag()
    .on("start", (ev, d) => {
      if (!ev.active) sim.alphaTarget(0.25).restart();
      d.fx = d.x;
      d.fy = d.y;
      d3.select(ev.sourceEvent?.target || null).style("cursor", "grabbing");
    })
    .on("drag", (ev, d) => {
      d.fx = ev.x;
      d.fy = ev.y;
    })
    .on("end", (ev, d) => {
      if (!ev.active) sim.alphaTarget(0);
      d3.select(ev.sourceEvent?.target || null).style("cursor", "grab");
    });

  node.call(drag);

  // ---- Reset button
  btn.on("click", () => {
    nodes.forEach(n => { n.fx = null; n.fy = null; });
    sim.alpha(1).restart();
  });

  // ---- Tick
  sim.on("tick", () => {
    // clamp to bounds (hard clamp avoids escaping)
    nodes.forEach(n => {
      const rr = r(n.total);
      n.x = Math.max(rr, Math.min(innerW - rr, n.x));
      n.y = Math.max(rr, Math.min(innerH - rr, n.y));
    });

    link
      .attr("x1", d => (typeof d.source === "string" ? nodeById.get(d.source).x : d.source.x))
      .attr("y1", d => (typeof d.source === "string" ? nodeById.get(d.source).y : d.source.y))
      .attr("x2", d => (typeof d.target === "string" ? nodeById.get(d.target).x : d.target.x))
      .attr("y2", d => (typeof d.target === "string" ? nodeById.get(d.target).y : d.target.y));

    node
      .attr("cx", d => d.x)
      .attr("cy", d => d.y);

    // label offset: above-right
    label
      .attr("x", d => d.x + r(d.total) + 6)
      .attr("y", d => d.y - 6);
  });

  // Caption
  root.append("div")
    .attr("class", "caption")
    .text(
      `Network (Top ${TOP_N} countries) — edges connect countries with cosine similarity ≥ ${SIM_THRESHOLD} `
      + `(top-${TOP_K} per node). Node size encodes total deaths in ${year}. Drag to pin; double-click to unpin.`
    );
}
