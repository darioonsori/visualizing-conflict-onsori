/***********************************************************
 * Charts for “Comparing Categories”
 * Data: OWID/UCDP “deaths-in-armed-conflicts-by-type.csv”
 * File path expected: data/conflict_deaths_by_type.csv
 ***********************************************************/

/* ---------------- Configuration ---------------- */
const DATA_PATH = "data/conflict_deaths_by_type.csv";
const SNAPSHOT_YEAR = 2023;                         // change if you prefer another year
const GROUPED_COUNTRIES_2023 = ["Ukraine", "Palestine", "Mexico", "Sudan", "Nigeria"]; // editable

// Color palette for conflict types (kept stable across charts)
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"])
  .range(["#6c8ae4","#f28e2b","#edc948","#59a14f","#e15759"]);

/* ---------------- Helpers ---------------- */

// Keep only sovereign countries (rows with a valid 3-letter ISO code)
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

// Auto-detect column names by keyword (more robust across minor header changes)
function detectColumns(headers){
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

// Simple fixed-position tooltip
const tip = (() => {
  const el = d3.select("body").append("div").attr("class","tooltip");
  return {
    show(html, [x,y]){
      el.html(html).style("left", x + "px").style("top", y + "px").style("opacity", 1);
    },
    hide(){ el.style("opacity", 0); }
  };
})();

/* ---------------- Load & Prepare ---------------- */
d3.csv(DATA_PATH).then(raw => {
  if (!raw?.length) throw new Error("CSV not found or empty.");

  // Detect headers and normalize records
  const COL = detectColumns(Object.keys(raw[0]));
  const rows = raw.map(d => ({
    entity: d[COL.entity],
    code: d[COL.code],
    year: +d[COL.year],
    Interstate: +d[COL.interstate] || 0,
    Intrastate: +d[COL.intrastate] || 0,
    Extrasystemic: +d[COL.extrasystemic] || 0,
    "Non-state": +d[COL.nonstate] || 0,
    "One-sided": +d[COL.onesided] || 0
  })).map(d => ({...d, total: d.Interstate + d.Intrastate + d.Extrasystemic + d["Non-state"] + d["One-sided"]}));

  // ---------------- Chart 1: Top-10 countries (snapshot) ----------------
  {
    const dataYear = rows.filter(d => d.year === SNAPSHOT_YEAR);
    // Keep only sovereign countries (valid ISO3) and drop “World”
    const countries = dataYear.filter(d => isISO3(d.code) && d.entity !== "World" && d.total > 0);
    const top10 = countries.sort((a,b) => d3.descending(a.total, b.total)).slice(0, 10)
      .map(d => ({ name: d.entity, value: d.total }));

    drawBar("#bar-top10-2023", top10, {
      width: 940,
      height: 360,
      label: "deaths",
      xFormat: d3.format(",")
    });
  }

  // ---------------- Chart 2: Grouped bar by type (selected countries) ----------------
  {
    const TYPE_KEYS = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
    const dataYear = rows.filter(d => d.year === SNAPSHOT_YEAR && isISO3(d.code));
    const subset = dataYear.filter(d => GROUPED_COUNTRIES_2023.includes(d.entity));

    const tidy = subset.map(d => ({
      group: d.entity,
      values: TYPE_KEYS.map(k => ({ key: k, value: d[k] }))
    }));

    drawGroupedBar("#grouped-2023", tidy, {
      keys: TYPE_KEYS,
      width: 940,
      height: 420
    });
  }

}).catch(err => {
  console.error(err);
});


/* =======================================================
   Reusable components
   ======================================================= */

/**
 * Horizontal bar chart for { name, value }[]
 */
function drawBar(selector, data, opts = {}){
  const {
    width = 900,
    height = 360,
    margin = { top: 6, right: 24, bottom: 36, left: 170 },
    xFormat = d3.format(","),
    label = ""
  } = opts;

  const svg = d3.select(selector).append("svg")
    .attr("width", width).attr("height", height);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.value) || 1]).nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map(d => d.name))
    .range([margin.top, height - margin.bottom])
    .padding(0.15);

  // axes
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(xFormat));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  // bars
  const g = svg.append("g");
  g.selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", x(0))
    .attr("y", d => y(d.name))
    .attr("height", y.bandwidth())
    .attr("width", d => x(d.value) - x(0))
    .attr("fill", "#8aa6ff")
    .on("mousemove", (event,d) => tip.show(`<b>${d.name}</b><br>${xFormat(d.value)} ${label}`, [event.clientX, event.clientY]))
    .on("mouseleave", tip.hide);

  // value labels
  svg.append("g").selectAll("text.val")
    .data(data)
    .join("text")
    .attr("class", "val")
    .attr("x", d => x(d.value) + 6)
    .attr("y", d => (y(d.name) ?? 0) + y.bandwidth()/2 + 4)
    .attr("fill", "#6b7280")
    .attr("font-size", 11)
    .text(d => xFormat(d.value));
}

/**
 * Grouped bar chart
 * rows: [{ group: "Country", values: [{key:"Interstate", value:...}, ...] }, ...]
 */
function drawGroupedBar(selector, rows, opts = {}){
  const {
    keys = [],
    width = 960,
    height = 420,
    margin = { top: 10, right: 20, bottom: 70, left: 56 }
  } = opts;

  const svg = d3.select(selector).append("svg")
    .attr("width", width).attr("height", height);

  const groups = rows.map(d => d.group);
  const flat = rows.flatMap(d => d.values.map(v => ({ group: d.group, key: v.key, value: v.value })));

  const x0 = d3.scaleBand().domain(groups).range([margin.left, width - margin.right]).padding(0.22);
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.08);
  const y  = d3.scaleLinear().domain([0, d3.max(flat, d => d.value) || 1]).nice()
               .range([height - margin.bottom, margin.top]);

  // axes
  svg.append("g").attr("class","axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x0))
    .selectAll("text")
    .attr("transform", "rotate(-18)")
    .style("text-anchor","end");

  svg.append("g").attr("class","axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5));

  // bars
  const g = svg.append("g");
  g.selectAll("g")
    .data(rows)
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
    .on("mousemove", (event,d) => tip.show(`<b>${d.key}</b><br>${d.value.toLocaleString()}`, [event.clientX, event.clientY]))
    .on("mouseleave", tip.hide);

  // legend
  const legend = d3.select(selector).append("div").attr("class","legend");
  keys.forEach(k => legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`));
}
