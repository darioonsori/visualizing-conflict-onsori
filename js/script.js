/************************************************************
 * Data-driven charts for: conflict_deaths_by_type.csv
 * Charts:
 *  1) Horizontal bar chart: Top-10 countries by total deaths (year = SNAPSHOT_YEAR)
 *  2) Grouped bar chart: deaths by conflict type for selected countries (year = SNAPSHOT_YEAR)
 *
 * Data assumptions (OWID/UCDP export):
 *  - Columns include: Entity, Code (ISO3 when country), Year,
 *    "Conflict type: Interstate", "Intrastate", "Extrasystemic", "Non-state", "One-sided"
 *  - Some rows are aggregates (regions like "Europe") with empty/non-ISO3 Code.
 *    We exclude those and also exclude "World".
 ************************************************************/

// ---------- Config ----------
const DATA_PATH = "data/conflict_deaths_by_type.csv";
const SNAPSHOT_YEAR = 2023; // change here if needed

// Countries to show in the grouped bar (same order as legend reading)
const FOCUS_COUNTRIES = ["Burkina Faso", "Mexico", "Palestine", "Sudan", "Ukraine"];

// Color palette for conflict types
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(["Interstate", "Intrastate", "Extrasystemic", "Non-state", "One-sided"])
  .range(["#6c8ae4", "#f28e2b", "#edc948", "#59a14f", "#e15759"]);

// Attach snapshot year to headings
d3.select("#year-top10-label").text(SNAPSHOT_YEAR);
d3.select("#year-grouped-label").text(SNAPSHOT_YEAR);

// ---------- Tooltip (shared) ----------
const tip = d3.select("#tooltip");
function showTip(html, [x, y]) {
  tip.html(html)
    .style("left", `${x}px`)
    .style("top", `${y}px`)
    .attr("hidden", null);
}
function hideTip() { tip.attr("hidden", true); }

// ---------- Helpers ----------
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

// Autodetect relevant column names by substring (robust to minor header variations)
function detectColumns(headers) {
  const h = headers.map(s => s.toLowerCase());
  const find = kw => headers[h.findIndex(x => x.includes(kw))];

  return {
    entity: find("entity"),
    code: find("code"),
    year: find("year"),
    interstate: find("conflict type: interstate"),
    intrastate: find("conflict type: intrastate"),
    extrasystemic: find("conflict type: extrasystemic"),
    nonstate: find("conflict type: non-state"),
    onesided: find("conflict type: one-sided"),
  };
}

// Parse row into tidy numeric object
function parseRow(d, C) {
  return {
    entity: d[C.entity],
    code: d[C.code],
    year: +d[C.year],
    Interstate: +d[C.interstate] || 0,
    Intrastate: +d[C.intrastate] || 0,
    Extrasystemic: +d[C.extrasystemic] || 0,
    "Non-state": +d[C.nonstate] || 0,
    "One-sided": +d[C.onesided] || 0,
  };
}

function totalDeaths(o) {
  return o.Interstate + o.Intrastate + o.Extrasystemic + o["Non-state"] + o["One-sided"];
}

// Exclude aggregates and World; keep rows with a valid country ISO3
function isCountryRow(r) {
  return r.entity !== "World" && isISO3(r.code);
}

// ---------- Load & Build ----------
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw?.length) {
    console.error("CSV is empty or could not be loaded.");
    return;
  }

  const C = detectColumns(Object.keys(raw[0]));
  const rows = raw.map(d => parseRow(d, C));

  const rowsCountries = rows.filter(isCountryRow);
  const rowsYear = rowsCountries.filter(d => d.year === SNAPSHOT_YEAR);

  // 1) Top-10 bar
  {
    const series = rowsYear
      .map(d => ({ name: d.entity, value: totalDeaths(d) }))
      .filter(d => d.value > 0)
      .sort((a, b) => d3.descending(a.value, b.value))
      .slice(0, 10);

    drawBar("#bar-top10-2023", series, {
      width: 920,
      height: 420,
      xFormat: d3.format(","),
      barFill: "#8aa6ff",
      tooltip: d => `<strong>${d.name}</strong><br/>${d3.format(",")(d.value)} deaths`,
    });
  }

  // 2) Grouped bar by type for selected countries
  {
    const KEYS = ["Interstate", "Intrastate", "Extrasystemic", "Non-state", "One-sided"];

    // Keep only data for selected focus countries (still subject to ISO3 filter)
    const rowsFocus = rowsYear.filter(d => FOCUS_COUNTRIES.includes(d.entity));

    const tidy = rowsFocus.map(d => ({
      group: d.entity,
      values: KEYS.map(k => ({ key: k, value: d[k] })),
    }));

    drawGroupedBar("#grouped-2023", tidy, {
      keys: KEYS,
      width: 980,
      height: 420,
      legendSel: "#legend-grouped",
      tooltip: (g, v) =>
        `<strong>${g}</strong> — ${v.key}<br/>${d3.format(",")(v.value)} deaths`,
    });
  }
}).catch(err => console.error("Error while loading CSV:", err));

/* =========================================================
 * Components
 * =======================================================*/

/**
 * Horizontal bar chart with smart value labels
 * - labels auto-switch inside/outside with adaptive color if near right edge
 */
function drawBar(sel, data, {
  width = 900,
  height = 380,
  margin = { top: 8, right: 24, bottom: 46, left: 190 },
  xFormat = d3.format(","),
  barFill = "#8aa6ff",
  tooltip = null,
} = {}) {
  const svg = d3.select(sel).html("").append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.value) || 1]).nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map(d => d.name))
    .range([margin.top, height - margin.bottom])
    .padding(0.16);

  // Axes
  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x).ticks(6).tickFormat(xFormat));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y));

  // Bars
  const bars = svg.append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", x(0))
    .attr("y", d => y(d.name))
    .attr("width", d => x(d.value) - x(0))
    .attr("height", y.bandwidth())
    .attr("fill", barFill);

  // Optional tooltip
  if (typeof tooltip === "function") {
    bars.on("mousemove", (ev, d) => showTip(tooltip(d), [ev.clientX, ev.clientY]))
        .on("mouseleave", hideTip);
  }

  // Smart value labels (auto inside/outside)
  svg.append("g")
    .selectAll("text.value")
    .data(data)
    .join("text")
      .attr("y", d => y(d.name) + y.bandwidth() / 2 + 4)
      .attr("x", d => {
        const end = x(d.value);
        const nearEdge = end + 56 > width - margin.right;
        return nearEdge ? end - 8 : end + 6;
      })
      .attr("text-anchor", d => {
        const end = x(d.value);
        return end + 56 > width - margin.right ? "end" : "start";
      })
      .style("fill", d => {
        const end = x(d.value);
        return end + 56 > width - margin.right ? "#fff" : "#333";
      })
      .style("font-size", "12px")
      .text(d => xFormat(d.value));
}

/**
 * Grouped bar chart: categories per group
 */
function drawGroupedBar(sel, rows, {
  keys,
  width = 980,
  height = 420,
  margin = { top: 8, right: 20, bottom: 64, left: 56 },
  legendSel = null,
  tooltip = null,
} = {}) {
  const svg = d3.select(sel).html("").append("svg")
    .attr("width", width)
    .attr("height", height);

  const groups = rows.map(d => d.group);
  const flat = rows.flatMap(d => d.values.map(v => ({ group: d.group, key: v.key, value: v.value })));

  const x0 = d3.scaleBand()
    .domain(groups)
    .range([margin.left, width - margin.right])
    .padding(0.22);

  const x1 = d3.scaleBand()
    .domain(keys)
    .range([0, x0.bandwidth()])
    .padding(0.08);

  const y = d3.scaleLinear()
    .domain([0, d3.max(flat, d => d.value) || 1]).nice()
    .range([height - margin.bottom, margin.top]);

  // Axes
  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x0))
    .selectAll("text")
    .attr("transform", "rotate(-16)")
    .style("text-anchor", "end");

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(",")));

  // Bars
  const groupsG = svg.append("g")
    .selectAll("g")
    .data(rows)
    .join("g")
      .attr("transform", d => `translate(${x0(d.group)},0)`);

  const rects = groupsG
    .selectAll("rect")
    .data(d => d.values)
    .join("rect")
      .attr("x", d => x1(d.key))
      .attr("y", d => y(d.value))
      .attr("width", x1.bandwidth())
      .attr("height", d => y(0) - y(d.value))
      .attr("fill", d => TYPE_COLORS(d.key));

  if (typeof tooltip === "function") {
    rects.on("mousemove", (ev, d) => {
      const g = d3.select(ev.currentTarget.parentNode).datum().group;
      showTip(tooltip(g, d), [ev.clientX, ev.clientY]);
    }).on("mouseleave", hideTip);
  }

  // Legend (below chart area or external container)
  const L = legendSel ? d3.select(legendSel).html("") : d3.select(sel).append("div").attr("class", "legend");
  keys.forEach(k => L.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`));
}
