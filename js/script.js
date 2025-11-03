/**************************************************************
 * Top 10 countries by conflict-related deaths (snapshot year)
 * Data: OWID/UCDP “conflict_deaths_by_type.csv”
 * Rule to exclude regions: keep rows with a valid ISO3 code
 * (exactly 3 uppercase letters) and drop “World”.
 **************************************************************/

const DATA_PATH = "data/conflict_deaths_by_type.csv"; // <-- path esatto come nella tua repo
const SNAPSHOT_YEAR = 2023;                            // <-- cambia se vuoi un altro anno

// Ensure container exists (defensive: if missing in HTML, create it)
let mount = d3.select("#bar-top10-2023");
if (mount.empty()) {
  mount = d3.select("body").append("div").attr("id", "bar-top10-2023");
}

/* ---------- Helpers ---------- */
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

/**
 * Auto-detect the relevant columns by name substring.
 * Works across minor header variations in OWID exports.
 */
function detectColumns(headers){
  const h = headers.map(s => s.toLowerCase());
  const find = kw => headers[h.findIndex(x => x.includes(kw))];

  return {
    entity:     find("entity")   || "Entity",
    code:       find("code")     || "Code",
    year:       find("year")     || "Year",
    interstate: find("conflict type: interstate"),
    intrastate: find("conflict type: intrastate"),
    extrasys:   find("conflict type: extrasystemic"), // may be absent in some cuts
    nonstate:   find("conflict type: non-state"),
    onesided:   find("conflict type: one-sided"),
  };
}

/**
 * Draw a simple horizontal bar chart.
 */
function drawBarChart(selection, data, opts = {}){
  const {
    width = 920,
    height = 430,
    margin = { top: 16, right: 24, bottom: 44, left: 180 },
    barColor = "#8aa6ff",
    xTickFormat = d3.format(",")
  } = opts;

  const svg = selection.append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.value) || 1]).nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map(d => d.name))
    .range([margin.top, height - margin.bottom])
    .padding(0.15);

  // Axes
  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x).ticks(6).tickFormat(xTickFormat));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y));

  // Bars
  svg.append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
      .attr("x", x(0))
      .attr("y", d => y(d.name))
      .attr("width", d => x(d.value) - x(0))
      .attr("height", y.bandwidth())
      .attr("fill", barColor);

  // Right-aligned value labels
  const fmt = d3.format(",");
  svg.append("g")
    .selectAll("text.value")
    .data(data)
    .join("text")
      .attr("class", "value")
      .attr("x", d => x(d.value) + 4)
      .attr("y", d => y(d.name) + y.bandwidth() / 2 + 4)
      .attr("fill", "#555")
      .style("font-size", "12px")
      .text(d => fmt(d.value));
}

/* ------------------ Load & filter ------------------ */
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw?.length) {
    console.error("CSV not loaded or empty");
    return;
  }

  const cols = detectColumns(Object.keys(raw[0]));

  // Normalize + sum across conflict types (missing columns -> 0)
  const rows = raw.map(r => {
    const rec = {
      entity: r[cols.entity],
      code:   r[cols.code],
      year:  +r[cols.year],
      Interstate:   +r[cols.interstate] || 0,
      Intrastate:   +r[cols.intrastate] || 0,
      Extrasystemic: cols.extrasys ? (+r[cols.extrasys] || 0) : 0,
      "Non-state":  +r[cols.nonstate]  || 0,
      "One-sided":  +r[cols.onesided]  || 0
    };
    rec.total = rec.Interstate + rec.Intrastate + rec.Extrasystemic + rec["Non-state"] + rec["One-sided"];
    return rec;
  });

  // Keep only true countries:
  // - Code must be a valid ISO3 (=== 3 uppercase letters)
  // - Exclude "World" explicitly in case it has a code in some cut
  const countryRows = rows.filter(d => isISO3(d.code) && d.entity !== "World");

  // Snapshot year (change SNAPSHOT_YEAR above if needed)
  const yearRows = countryRows.filter(d => d.year === SNAPSHOT_YEAR && d.total > 0);

  // Top 10 countries
  const top10 = d3.sort(yearRows, (a, b) => d3.descending(a.total, b.total))
                  .slice(0, 10)
                  .map(d => ({ name: d.entity, value: d.total }));

  // Render
  mount.selectAll("*").remove();
  drawBarChart(mount, top10);

  // Source note (kept in HTML too, but useful if the chart is re-mounted elsewhere)
  mount.append("div")
    .attr("class", "chart-note")
    .style("margin-top", "6px")
    .text("Source: UCDP via Our World in Data. Values are absolute counts; regional aggregates excluded by ISO3 filtering.");
})
.catch(err => console.error("Error loading CSV:", err));
