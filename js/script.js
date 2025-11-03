/*********************************************************
 * Top-10 chart (2023) + Grouped bar (top-5 auto-detected)
 * Data: OWID/UCDP "deaths-in-armed-conflicts-by-type.csv"
 * Filtering: keep rows with a valid ISO3 country code and
 *            drop aggregates like "World", "Europe", etc.
 *********************************************************/

const DATA_PATH = "data/conflict_deaths_by_type.csv";
const SNAPSHOT_YEAR = 2023; // cambia se vuoi un altro anno

// ---------- Utilities ----------
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

// Try to detect column names even if headers vary slightly
function detectColumns(headers) {
  const h = headers.map(s => s.toLowerCase());
  const find = kw => headers[h.findIndex(x => x.includes(kw))];

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

// ---------- Load & prepare ----------
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw || !raw.length) {
    console.error("CSV empty or not loaded:", DATA_PATH);
    return;
  }

  const COL = detectColumns(Object.keys(raw[0]));
  const tidy = raw.map(d => ({
    entity: d[COL.entity],
    code: d[COL.code],
    year: +d[COL.year],
    Interstate: +d[COL.interstate] || 0,
    Intrastate: +d[COL.intrastate] || 0,
    Extrasystemic: +d[COL.extrasystemic] || 0,
    "Non-state": +d[COL.nonstate] || 0,
    "One-sided": +d[COL.onesided] || 0
  })).map(d => ({
    ...d,
    total: d.Interstate + d.Intrastate + d.Extrasystemic + d["Non-state"] + d["One-sided"]
  }));

  // Keep only rows with a valid ISO3 -> removes regions/aggregates automatically
  const countriesOnly = tidy.filter(d => isISO3(d.code));

  // ---------- 1) Top-10 countries (2023) ----------
  const rows2023 = countriesOnly.filter(d => d.year === SNAPSHOT_YEAR && d.total > 0);
  const top10 = rows2023
    .sort((a, b) => d3.descending(a.total, b.total))
    .slice(0, 10)
    .map(d => ({ name: d.entity, value: d.total }));

  drawBar("#bar-top10-2023", top10, {
    width: 980,
    height: 380,
    title: "Countries with the highest conflict-related deaths in 2023 (Top 10)",
    xFormat: d3.format(",")
  });

  // ---------- 2) Grouped bar (auto-detected top-5) ----------
  const KEYS = ["Interstate", "Intrastate", "Extrasystemic", "Non-state", "One-sided"];

  const top5Names = rows2023
    .sort((a, b) => d3.descending(a.total, b.total))
    .slice(0, 5)
    .map(d => d.entity);

  console.log("Grouped bar — selected countries:", top5Names);

  const groupedRows = countriesOnly
    .filter(d => d.year === SNAPSHOT_YEAR && top5Names.includes(d.entity))
    .map(d => ({
      group: d.entity,
      values: KEYS.map(k => ({ key: k, value: d[k] }))
    }));

  drawGroupedBar("#grouped-2023", groupedRows, {
    keys: KEYS,
    width: 980,
    height: 440,
    title: "Conflict deaths by type (selected countries, 2023)"
  });
}).catch(err => {
  console.error("Failed to load CSV:", err);
});


// ===================== Components =====================

// Horizontal bar
function drawBar(sel, data, { width=900, height=360, margin={top:8,right:24,bottom:36,left:180}, xFormat=d3.format(","), title="" } = {}) {
  const wrap = d3.select(sel);
  wrap.selectAll("*").remove();

  if (title) wrap.append("div").attr("class", "chart-title").text(title);

  const svg = wrap.append("svg").attr("width", width).attr("height", height);
  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.value) || 1]).nice()
    .range([margin.left, width - margin.right]);
  const y = d3.scaleBand()
    .domain(data.map(d => d.name))
    .range([margin.top, height - margin.bottom])
    .padding(0.15);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x).ticks(6).tickFormat(xFormat));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y));

  svg.append("g").selectAll("rect")
    .data(data)
    .join("rect")
      .attr("x", x(0))
      .attr("y", d => y(d.name))
      .attr("width", d => x(d.value) - x(0))
      .attr("height", y.bandwidth())
      .attr("fill", "#8aa6ff");

  // value labels
  const fmt = xFormat;
  svg.append("g").selectAll("text.value")
    .data(data)
    .join("text")
      .attr("class", "value")
      .attr("x", d => x(d.value) + 4)
      .attr("y", d => y(d.name) + y.bandwidth()/2 + 4)
      .text(d => fmt(d.value))
      .style("font-size", "12px")
      .style("fill", "#555");
}

// Grouped bar
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"])
  .range(["#6c8ae4","#f28e2b","#edc948","#59a14f","#e15759"]);

function drawGroupedBar(sel, rows, {
  keys,
  width=980,
  height=440,
  margin={top:10,right:20,bottom:70,left:64},
  title=""
} = {}) {
  const wrap = d3.select(sel);
  wrap.selectAll("*").remove();

  if (title) wrap.append("div").attr("class", "chart-title").text(title);

  if (!rows.length) {
    wrap.append("div").attr("class", "chart-note")
      .text("No data available for the selected year/countries.");
    return;
  }

  const svg = wrap.append("svg").attr("width", width).attr("height", height);
  const groups = rows.map(d => d.group);
  const flat = rows.flatMap(d => d.values.map(v => ({ group: d.group, key: v.key, value: v.value })));

  const x0 = d3.scaleBand().domain(groups).range([margin.left, width - margin.right]).padding(0.2);
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear()
    .domain([0, d3.max(flat, d => d.value) || 1]).nice()
    .range([height - margin.bottom, margin.top]);

  // gridlines orizzontali leggere per la lettura dei valori
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSize(- (width - margin.left - margin.right)).tickFormat(""))
    .selectAll("line").attr("stroke", "#e9ecef");

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x0));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(",")));

  // barre raggruppate
  const gGroup = svg.selectAll("g.group")
    .data(rows)
    .join("g")
    .attr("class", "group")
    .attr("transform", d => `translate(${x0(d.group)},0)`);

  gGroup.selectAll("rect")
    .data(d => d.values)
    .join("rect")
      .attr("x", d => x1(d.key))
      .attr("y", d => y(d.value))
      .attr("width", x1.bandwidth())
      .attr("height", d => y(0) - y(d.value))
      .attr("fill", d => TYPE_COLORS(d.key));

  // legenda compatta
  const legend = wrap.append("div").attr("class", "legend");
  keys.forEach(k => {
    legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`);
  });
}
