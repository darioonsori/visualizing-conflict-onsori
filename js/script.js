/*********************************************************
 * Dario Onsori - Data Visualization (2025)
 * Charts: Top-10 bar + Grouped bar
 * Data: OWID / UCDP "deaths-in-armed-conflicts-by-type.csv"
 * Filtering: keep valid ISO3 countries (exclude regions)
 *********************************************************/

const DATA_PATH = "data/conflict_deaths_by_type.csv";
const SNAPSHOT_YEAR = 2023;

// ---------- Utilities ----------
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

// auto-detect CSV column names
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

// ---------- Load and process ----------
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw || !raw.length) {
    console.error("CSV not loaded:", DATA_PATH);
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

  // filter out regional aggregates (keep only ISO3-coded)
  const countriesOnly = tidy.filter(d => isISO3(d.code));

  // ========== 1) TOP-10 BAR CHART ==========
  const rows2023 = countriesOnly.filter(d => d.year === SNAPSHOT_YEAR && d.total > 0);
  const top10 = rows2023
    .sort((a, b) => d3.descending(a.total, b.total))
    .slice(0, 10)
    .map(d => ({ name: d.entity, value: d.total }));

  drawBar("#bar-top10-2023", top10, {
    width: 980,
    height: 400,
    title: `Countries with the highest conflict-related deaths in ${SNAPSHOT_YEAR} (Top 10)`
  });

  // ========== 2) GROUPED BAR ==========
  const KEYS = ["Interstate", "Intrastate", "Extrasystemic", "Non-state", "One-sided"];
  const top5Names = rows2023
    .sort((a, b) => d3.descending(a.total, b.total))
    .slice(0, 5)
    .map(d => d.entity);

  console.log("Grouped bar – selected countries:", top5Names);

  const groupedRows = countriesOnly
    .filter(d => d.year === SNAPSHOT_YEAR && top5Names.includes(d.entity))
    .map(d => ({
      group: d.entity,
      values: KEYS.map(k => ({ key: k, value: d[k] }))
    }));

  drawGroupedBar("#grouped-2023", groupedRows, {
    keys: KEYS,
    width: 980,
    height: 460,
    title: `Conflict deaths by type (selected countries, ${SNAPSHOT_YEAR})`
  });
});

// ---------- COLOR SCALE ----------
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"])
  .range(["#6c8ae4","#f28e2b","#edc948","#59a14f","#e15759"]);

// ==========================================================
// ============== VISUAL COMPONENTS =========================
// ==========================================================

// ----- Horizontal bar chart -----
function drawBar(sel, data, { width=900, height=380, margin={top:10,right:30,bottom:40,left:180}, title="" } = {}) {
  const wrap = d3.select(sel);
  wrap.selectAll("*").remove();

  if (title) wrap.append("div").attr("class","chart-title").text(title);

  const svg = wrap.append("svg").attr("width",width).attr("height",height);
  const x = d3.scaleLinear()
    .domain([0, d3.max(data,d=>d.value)||1]).nice()
    .range([margin.left, width-margin.right]);
  const y = d3.scaleBand()
    .domain(data.map(d=>d.name))
    .range([margin.top, height-margin.bottom])
    .padding(0.15);

  svg.append("g")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .attr("class","axis")
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format(",")));

  svg.append("g")
    .attr("transform",`translate(${margin.left},0)`)
    .attr("class","axis")
    .call(d3.axisLeft(y));

  svg.append("g").selectAll("rect")
    .data(data).join("rect")
      .attr("x", x(0))
      .attr("y", d => y(d.name))
      .attr("width", d => x(d.value) - x(0))
      .attr("height", y.bandwidth())
      .attr("fill", "#8aa6ff");

  // value labels (always visible, right of each bar)
  svg.append("g").selectAll("text.value")
    .data(data)
    .join("text")
      .attr("x", d => x(d.value) + 6)
      .attr("y", d => y(d.name) + y.bandwidth()/2 + 4)
      .text(d => d3.format(",")(d.value))
      .style("font-size", "12px")
      .style("fill", "#333");

  // caption
  wrap.append("div")
    .attr("class","chart-caption")
    .text(`Horizontal bars compare absolute totals. Values are counts of deaths (combatants and civilians) during ongoing armed conflicts. Data source: UCDP via Our World in Data. Regional aggregates (e.g., Europe, Africa) are excluded.`);
}

// ----- Grouped bar chart -----
function drawGroupedBar(sel, rows, { keys, width=960, height=440, margin={top:10,right:30,bottom:80,left:70}, title="" } = {}) {
  const wrap = d3.select(sel);
  wrap.selectAll("*").remove();

  if (title) wrap.append("div").attr("class","chart-title").text(title);
  if (!rows.length) {
    wrap.append("div").attr("class","chart-note").text("No data available.");
    return;
  }

  const totals = new Map(rows.map(d => [d.group, d3.sum(d.values, v => v.value)]));
  rows.sort((a,b) => d3.descending(totals.get(a.group), totals.get(b.group)));

  const svg = wrap.append("svg").attr("width",width).attr("height",height);
  const groups = rows.map(d=>d.group);
  const flat = rows.flatMap(d=>d.values.map(v => ({group:d.group, key:v.key, value:v.value})));

  const x0 = d3.scaleBand().domain(groups).range([margin.left, width-margin.right]).padding(0.2);
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear()
    .domain([0, d3.max(flat,d=>d.value)||1]).nice()
    .range([height-margin.bottom, margin.top]);

  // gridlines
  svg.append("g")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)).tickFormat(""))
    .selectAll("line").attr("stroke","#e9ecef");

  // axes
  svg.append("g")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .attr("class","axis")
    .call(d3.axisBottom(x0));

  svg.append("g")
    .attr("transform",`translate(${margin.left},0)`)
    .attr("class","axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(",")));

  // y label
  svg.append("text")
    .attr("x", margin.left - 55)
    .attr("y", margin.top - 10)
    .attr("text-anchor","start")
    .attr("class","axis-label")
    .text("Deaths (absolute)");

  // tooltip
  const tip = d3.select("body").append("div").attr("class","tooltip").style("opacity",0);

  svg.selectAll("g.group")
    .data(rows)
    .join("g")
      .attr("class","group")
      .attr("transform", d => `translate(${x0(d.group)},0)`)
    .selectAll("rect")
    .data(d => d.values)
    .join("rect")
      .attr("x", d => x1(d.key))
      .attr("y", d => y(d.value))
      .attr("width", x1.bandwidth())
      .attr("height", d => y(0)-y(d.value))
      .attr("fill", d => TYPE_COLORS(d.key))
      .on("mousemove", (event,d) => {
        tip.style("opacity",1)
          .html(`<strong>${d.key}</strong><br>${d3.format(",")(d.value)} deaths`)
          .style("left", (event.pageX+10)+"px")
          .style("top", (event.pageY-20)+"px");
      })
      .on("mouseleave", () => tip.style("opacity",0));

  // legend
  const legend = wrap.append("div").attr("class","legend");
  keys.forEach(k => {
    legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`);
  });

  // caption
  wrap.append("div")
    .attr("class","chart-caption")
    .text(`Bars are grouped by country; color encodes conflict type (UCDP categories). Snapshot year: ${SNAPSHOT_YEAR}. Countries are filtered by valid ISO3 code; regional aggregates and “World” are excluded.`);
}
