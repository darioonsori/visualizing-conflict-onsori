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
 *******************************************************/

/* ---------- Config ---------- */
const DATA_PATH = "data/conflict_deaths_by_type.csv"; // path in the repo
const WORLD_GEO_PATH = "data/world_countries.geojson";
const SNAPSHOT_YEAR = 2023;
const FOCUS_COUNTRIES = ["Ukraine","Palestine","Sudan","Mexico","Burkina Faso"];

const TYPE_ORDER = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(TYPE_ORDER)
  .range(["#6c8ae4","#f28e2b","#edc948","#59a14f","#e15759"]);

// --- Geo config for maps ---
const WORLD_GEOJSON_PATH = "data/world_countries.geojson"; 
const GEO_ID_PROP        = "ISO_A3";                       // property del GeoJSON con il codice ISO3

/* ---------- Shared tooltip ---------- */
// Single floating tooltip reused by all charts
const tip = d3.select("body").append("div")
  .attr("class","tooltip")
  .style("opacity", 0);

/* ---------- Utilities ---------- */

// Inject a lightweight message inside the target container
function alertIn(sel, msg){
  const box = d3.select(sel);
  if (!box.empty()){
    box.html("").append("div").attr("class","alert").text(msg);
  }
}

// True ISO-3 code → lets us drop regions/aggregates
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

// Make column discovery resilient to OWID header wording
function detectColumns(headers){
  const norm = s => s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const H = headers.map(h => ({ raw: h, n: norm(h) }));
  const pick = (...needles) => {
    const i = H.findIndex(({n}) => needles.some(nd => n.includes(nd)));
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
    onesided:      pick("conflict type: one-sided", " one-sided violence", " one sided"),
  };
}

// Normalize one CSV row into canonical fields and compute a total
function mapRow(d, C){
  const r = {
    entity: d[C.entity],
    code:   d[C.code],
    year:  +d[C.year],
    Interstate:    +d[C.interstate]    || 0,
    Intrastate:    +d[C.intrastate]    || 0,
    Extrasystemic: +d[C.extrasystemic] || 0,
    "Non-state":   +d[C.nonstate]      || 0,
    "One-sided":   +d[C.onesided]      || 0,
  };
  r.total = TYPE_ORDER.reduce((acc, k) => acc + (r[k] || 0), 0);
  r.iso3  = r.code;  
  return r;
}

/* ---------- Data load + dispatch ---------- */
Promise.all([
  d3.csv(DATA_PATH, d3.autoType),
  d3.json(WORLD_GEO_PATH)
]).then(([raw, worldGeo]) => {

  if (!raw?.length) throw new Error("CSV is empty.");

  const headers = Object.keys(raw[0]);
  const C = detectColumns(headers);

  // Minimal set needed to render the page
  const required = [C.entity, C.code, C.year, C.intrastate, C.nonstate, C.onesided];
  if (required.some(x => !x)) {
    ["#bar-top10","#grouped","#heatmap","#stack100","#waffle",
     "#histogram","#violin","#boxplot","#timeseries","#map-choropleth"]
      .forEach(sel =>
        alertIn(sel, "Could not detect required columns in the CSV.")
      );
    return;
  }

  const rows      = raw.map(d => mapRow(d, C));
  const countries = rows.filter(r => isISO3(r.code) && r.entity !== "World");
  const worldOnly = rows.filter(r => r.entity === "World");

  // GeoJSON features (world map)
  const worldFeatures = (worldGeo && worldGeo.features) ? worldGeo.features : worldGeo;
  const worldFC = { type: "FeatureCollection", features: worldFeatures };

  // Year labels in the HTML
  d3.select("#year-top").text(SNAPSHOT_YEAR);
  d3.select("#year-grouped").text(SNAPSHOT_YEAR);
  d3.select("#year-waffle").text(SNAPSHOT_YEAR);
  d3.select("#waffle-year").text(SNAPSHOT_YEAR);

  // 1) Top-10 countries (absolute totals, Y)
  drawTop10Bar("#bar-top10", countries, SNAPSHOT_YEAR);

  // 2) Selected countries by conflict type (grouped, Y)
  drawGroupedByType("#grouped", countries, SNAPSHOT_YEAR, FOCUS_COUNTRIES);

  // 3) World totals by type × year (heatmap)
  drawWorldHeatmap("#heatmap", worldOnly);

  // 4) World shares by type over time (100% stacked)
  drawStacked100("#stack100", worldOnly);

  // 5) World composition in Y (waffle)
  drawWaffle("#waffle", worldOnly, SNAPSHOT_YEAR);

  // 6) Country totals in Y (histogram)
  drawHistogram("#histogram", countries, SNAPSHOT_YEAR);

  // 7) Distribution by type in Y (violin)
  drawViolin("#violin", countries, SNAPSHOT_YEAR);

  // 8) Country distribution by type in Y (boxplot)
  drawBoxplot("#boxplot", countries, SNAPSHOT_YEAR);

  // 9) Time series (World totals over time)
  drawTimeSeries("#timeseries", worldOnly);

  // 10) Choropleth map (NEW)
  drawChoropleth("#map-choropleth", worldFC, countries, SNAPSHOT_YEAR);
  
}).catch(err => {
  console.error(err);
  ["#bar-top10","#grouped","#heatmap","#stack100","#waffle",
   "#histogram","#violin","#boxplot","#timeseries","#map-choropleth"]
    .forEach(sel =>
      alertIn(sel, "Failed to load data. Expected CSV and GeoJSON in /data.")
    );
});

/* ===================== CHARTS ===================== */

/* 1) Top-10 barchart */
function drawTop10Bar(sel, data, year){
  const rows = data.filter(d => d.year === year && d.total > 0);
  if (!rows.length){ alertIn(sel, `No country data for year ${year}.`); return; }

  const top10 = rows.sort((a,b)=>d3.descending(a.total,b.total)).slice(0,10);

  const width=900, height=360, margin={top:10,right:28,bottom:44,left:220};
  const svg = d3.select(sel).html("").append("svg").attr("width",width).attr("height",height);

  const x = d3.scaleLinear()
    .domain([0, d3.max(top10,d=>d.total)||1]).nice()
    .range([margin.left, width-margin.right]);

  const y = d3.scaleBand()
    .domain(top10.map(d=>d.entity))
    .range([margin.top, height-margin.bottom])
    .padding(0.18);

  // grid
  svg.append("g")
    .attr("class","grid")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickSize(-(height-margin.top-margin.bottom)).tickFormat(""));

  // axes
  svg.append("g").attr("class","axis")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format(",")));

  svg.append("g").attr("class","axis")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  // bars
  svg.append("g").selectAll("rect").data(top10).join("rect")
    .attr("x", x(0)).attr("y", d=>y(d.entity))
    .attr("width", d=>x(d.total)-x(0)).attr("height", y.bandwidth())
    .attr("fill", "#8da2fb")
    .on("mousemove",(ev,d)=>{
      tip.style("opacity",1)
        .html(`<strong>${d.entity}</strong><br/>${d3.format(",")(d.total)} deaths`)
        .style("left", (ev.pageX)+"px").style("top",(ev.pageY)+"px");
    })
    .on("mouseleave",()=> tip.style("opacity",0));

  // Value labels with edge-avoidance (works when bar touches the right border)
  const fmt = d3.format(",");
  const EDGE_PAD = 84;
  svg.append("g").selectAll("text.value").data(top10).join("text")
    .attr("class","value")
    .attr("y", d=> y(d.entity)+y.bandwidth()/2)
    .attr("dy","0.32em")
    .text(d => fmt(d.total))
    .attr("x", d=>{
      const xr=x(d.total);
      return (width-margin.right-xr)<EDGE_PAD ? xr-6 : xr+6;
    })
    .attr("text-anchor", d=> (width-margin.right-x(d.total))<EDGE_PAD ? "end" : "start")
    .attr("fill", d=> (width-margin.right-x(d.total))<EDGE_PAD ? "white" : "#111827")
    .style("font-size","12px");
}

/* 2) Grouped barchart (selected countries × conflict type) */
function drawGroupedByType(sel, data, year, focus){
  const rows = data.filter(d => d.year===year && focus.includes(d.entity));
  if (!rows.length){ alertIn(sel, `No data for selected countries in ${year}.`); return; }

  const groups = focus.filter(c => rows.some(r => r.entity===c));
  const tidy = groups.map(g => {
    const d = rows.find(r => r.entity===g);
    return { group:g, values: TYPE_ORDER.map(k => ({key:k, value:d?d[k]:0})) };
  });

  const width=900, height=360, margin={top:10,right:24,bottom:62,left:56};
  const svg = d3.select(sel).html("").append("svg").attr("width",width).attr("height",height);

  const x0 = d3.scaleBand().domain(groups).range([margin.left, width-margin.right]).padding(0.22);
  const x1 = d3.scaleBand().domain(TYPE_ORDER).range([0, x0.bandwidth()]).padding(0.08);
  const y  = d3.scaleLinear()
    .domain([0, d3.max(tidy.flatMap(t=>t.values), d=>d.value)||1]).nice()
    .range([height-margin.bottom, margin.top]);

  svg.append("g").attr("class","axis")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x0))
    .selectAll("text").attr("transform","rotate(-18)").style("text-anchor","end");

  svg.append("g").attr("class","axis")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(",")));

  svg.append("g").selectAll("g").data(tidy).join("g")
    .attr("transform",d=>`translate(${x0(d.group)},0)`)
    .selectAll("rect").data(d=>d.values).join("rect")
      .attr("x", d=>x1(d.key)).attr("y", d=>y(d.value))
      .attr("width", x1.bandwidth()).attr("height", d=>y(0)-y(d.value))
      .attr("fill", d=>TYPE_COLORS(d.key))
      .on("mousemove",(ev,d)=>{
        tip.style("opacity",1)
          .html(`<strong>${d.key}</strong><br/>${d3.format(",")(d.value)} deaths`)
          .style("left",(ev.pageX)+"px").style("top",(ev.pageY)+"px");
      })
      .on("mouseleave",()=> tip.style("opacity",0));

  // Legend (pills under the chart)
  const legend = d3.select(sel).append("div").attr("class","legend");
  TYPE_ORDER.forEach(k=>{
    const item = legend.append("span").attr("class","pill");
    item.append("span").attr("class","swatch").style("background", TYPE_COLORS(k));
    item.append("span").text(k);
  });
}

/* 3) Heatmap (World totals per type × year) */
function drawWorldHeatmap(sel, worldRows){
  if (!worldRows.length){ alertIn(sel, "No World aggregate rows found."); return; }

  const years = worldRows.map(d=>d.year).sort((a,b)=>a-b);
  const cells = [];
  worldRows.forEach(d => TYPE_ORDER.forEach(k => cells.push({row:k, col:d.year, value:d[k]})));

  const width=900, height=280, margin={top:36,right:18,bottom:34,left:110}; // extra top for legend label
  const svg = d3.select(sel).html("").append("svg").attr("width",width).attr("height",height);

  const x = d3.scaleBand().domain(years).range([margin.left, width-margin.right]).padding(0);
  const y = d3.scaleBand().domain(TYPE_ORDER).range([margin.top, height-margin.bottom]).padding(0.06);

  const max = d3.max(cells, d=>d.value)||1;
  const color = d3.scaleSequential(d3.interpolateOrRd).domain([0,max]);

  svg.append("g").selectAll("rect").data(cells).join("rect")
    .attr("x", d=>x(d.col)).attr("y", d=>y(d.row))
    .attr("width", x.bandwidth()).attr("height", y.bandwidth())
    .attr("fill", d=>color(d.value))
    .on("mousemove",(ev,d)=>{
      tip.style("opacity",1)
        .html(`<strong>${d.row}</strong> — ${d.col}<br/>${d3.format(",")(d.value)} deaths`)
        .style("left",(ev.pageX)+"px").style("top",(ev.pageY)+"px");
    })
    .on("mouseleave",()=> tip.style("opacity",0));

  const xticks = years.filter(y => y%4===0 || y===years[0] || y===years.at(-1));
  svg.append("g").attr("class","axis")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(xticks).tickSize(0));

  svg.append("g").attr("class","axis")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickSize(0));

  // Gradient legend + label (no duplication)
  const legendW=220, legendH=10, legendX=width-legendW-18, legendY=margin.top-18;
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id","hm-grad");
  grad.append("stop").attr("offset","0%").attr("stop-color", color(0));
  grad.append("stop").attr("offset","100%").attr("stop-color", color(max));

  svg.append("rect")
    .attr("x",legendX).attr("y",legendY)
    .attr("width",legendW).attr("height",legendH)
    .attr("fill","url(#hm-grad)");

  const s = d3.scaleLog().domain([1,max]).range([legendX, legendX+legendW]); // log scale ticks
  svg.append("g").attr("class","axis")
    .attr("transform",`translate(0,${legendY+legendH})`)
    .call(d3.axisBottom(s).ticks(3, "~s"));

  // Label centered above the legend
  svg.append("text")
    .attr("x", legendX + legendW / 2)
    .attr("y", legendY - 6)
    .attr("text-anchor", "middle")
    .attr("fill", "#555")
    .attr("font-size", "12px")
    .text("Number of deaths (log scale)");
}

/* 4) 100% stacked barchart (shares by type over time, World) */
function drawStacked100(sel, worldRows){
  if (!worldRows.length){ alertIn(sel, "No World aggregate rows found."); return; }

  // map year -> absolute row (per tooltip con valori assoluti)
  const absByYear = new Map(worldRows.map(r => [r.year, r]));

  // Costruisco righe di proporzioni per ogni anno
  const years = worldRows.map(d=>d.year).sort((a,b)=>a-b);
  const propRows = years.map(y => {
    const d = absByYear.get(y);
    const sum = d3.sum(TYPE_ORDER, k => d[k] || 0) || 1;
    const r = { year:y };
    TYPE_ORDER.forEach(k => r[k] = (d[k]||0)/sum);
    return r;
  });

  const width=900, height=360, margin={top:8,right:24,bottom:58,left:52};
  const svg = d3.select(sel).html("").append("svg").attr("width",width).attr("height",height);

  const x = d3.scaleBand().domain(years).range([margin.left, width-margin.right]).padding(0.08);
  const y = d3.scaleLinear().domain([0,1]).range([height-margin.bottom, margin.top]);

  const stack = d3.stack().keys(TYPE_ORDER).order(d3.stackOrderNone).offset(d3.stackOffsetExpand);
  const series = stack(propRows);

  // griglia orizzontale
  svg.append("g")
    .attr("class","grid")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x).tickSize(-(height-margin.top-margin.bottom)).tickFormat(""))
    .selectAll("line").attr("opacity",0); // nascondo le verticali, tengo solo l'effetto di background

  svg.append("g")
    .attr("class","grid")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickValues([0,.25,.5,.75,1]).tickSize(-(width-margin.left-margin.right)).tickFormat(""))
    .selectAll("line").attr("opacity",0.35);

  // bars
  svg.append("g").selectAll("g").data(series).join("g")
    .attr("fill", d => TYPE_COLORS(d.key))
    .selectAll("rect").data(d => d).join("rect")
      .attr("x", d => x(d.data.year))
      .attr("y", d => y(d[1]))
      .attr("height", d => y(d[0]) - y(d[1]))
      .attr("width", x.bandwidth())
      .on("mousemove",(ev,d)=>{
        const key = d3.select(ev.currentTarget.parentNode).datum().key; // nome del tipo
        const year = d.data.year;
        const pct  = (d[1]-d[0]) * 100;
        const abs  = absByYear.get(year)?.[key] ?? 0;
        tip.style("opacity",1)
          .html(`<strong>${key}</strong> — ${year}<br/>${pct.toFixed(0)}%  (${d3.format(",")(abs)} deaths)`)
          .style("left",(ev.pageX)+"px").style("top",(ev.pageY)+"px");
      })
      .on("mouseleave",()=> tip.style("opacity",0));

  // axes
  svg.append("g").attr("class","axis")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(years.filter(y => y%2===0)));

  svg.append("g").attr("class","axis")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickValues([0,.25,.5,.75,1]).tickFormat(d3.format(".0%")));

  // legend
  const legend = d3.select(sel).append("div").attr("class","legend");
  TYPE_ORDER.forEach(k=>{
    const item = legend.append("span").attr("class","pill");
    item.append("span").attr("class","swatch").style("background", TYPE_COLORS(k));
    item.append("span").text(k);
  });
}

/* 5) Waffle chart (World composition in a single year) */
function drawWaffle(sel, worldRows, year){
  const d = worldRows.find(r => r.year === year);
  if (!d){ alertIn(sel, `No World data for year ${year}.`); return; }

  // Compute shares
  const totals = TYPE_ORDER.map(k => d[k] || 0);
  const sum = d3.sum(totals) || 1;
  const shares = TYPE_ORDER.map(k => ({ key:k, value: d[k]||0, pct: (d[k]||0)/sum }));

  // Grid definition (10×10 = 100 squares)
  const cols = 10, rows = 10, totalCells = cols*rows;
  const cellsByType = shares.map(s => ({ key:s.key, cells: Math.round(s.pct * totalCells), value:s.value, pct:s.pct }));
  const used = d3.sum(cellsByType, c => c.cells);
  if (used !== totalCells){
    // Add/subtract to make it sum exactly to 100 (rounding fix)
    const diff = totalCells - used;
    cellsByType[0].cells += diff;
  }

  // Build the 100 cells in type order (legend order)
  const grid = [];
  cellsByType.forEach(s => {
    for (let i=0; i<s.cells; i++){
      grid.push({ key: s.key, value: s.value, pct: s.pct });
    }
  });

  const width=900, height=360;
  const margin={top:18,right:18,bottom:10,left:18};
  const cell = 20, gap = 4;

  const svg = d3.select(sel).html("").append("svg").attr("width",width).attr("height",height);

  // Center the 10×10 block
  const blockW = cols*cell + (cols-1)*gap;
  const blockH = rows*cell + (rows-1)*gap;
  const startX = (width  - blockW)/2;
  const startY = (height - blockH)/2 - 6;

  svg.append("g").selectAll("rect").data(grid).join("rect")
    .attr("x", (_,i)=> startX + (i%cols)*(cell+gap))
    .attr("y", (_,i)=> startY + Math.floor(i/cols)*(cell+gap))
    .attr("width", cell)
    .attr("height", cell)
    .attr("rx", 4).attr("ry", 4)
    .attr("fill", d=> TYPE_COLORS(d.key))
    .on("mousemove",(ev,d)=>{
      tip.style("opacity",1)
        .html(`<strong>${d.key}</strong><br/>${d3.format(",")(d.value)} deaths<br/>${Math.round(d.pct*100)}% of ${year}`)
        .style("left",(ev.pageX)+"px").style("top",(ev.pageY)+"px");
    })
    .on("mouseleave",()=> tip.style("opacity",0));

  // Update the single caption’s year in HTML (no extra caption from JS)
  d3.select("#waffle-year").text(year);

  // Legend (pills) under the waffle
  const legend = d3.select(sel).append("div").attr("class","legend");
  TYPE_ORDER.forEach(k=>{
    const item = legend.append("span").attr("class","pill");
    item.append("span").attr("class","swatch").style("background", TYPE_COLORS(k));
    item.append("span").text(k);
  });
}

/* 6) Histogram — total conflict-related deaths per country (snapshot year) */
function drawHistogram(sel, data, year){
  // 1) Prepare values: one total per country for the selected year
  const rows = data.filter(d => d.year === year && d.total > 0);
  if (!rows.length){ alertIn(sel, `No country data for year ${year}.`); return; }

  const values = rows.map(d => d.total);

  // 2) Guard the heavy right tail with a 99th percentile clip (keeps the chart readable)
  const q99 = d3.quantile(values.slice().sort(d3.ascending), 0.99) || d3.max(values);
  const domainMax = Math.max(1, q99); // avoid 0 in degenerate cases

  // 3) Build bins (20 is a good default for presentation)
  const bin = d3.bin()
    .domain([0, domainMax])
    .thresholds(20);

  // Clamp values to the domain [0, domainMax] before binning
  const clamped = values.map(v => Math.min(v, domainMax));
  const bins = bin(clamped);

  // 4) Scales and layout
  const width = 900, height = 360;
  const margin = { top: 10, right: 22, bottom: 72, left: 56 };

  const x = d3.scaleLinear()
    .domain([0, domainMax])
    .range([margin.left, width - margin.right]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(bins, d => d.length) || 1]).nice()
    .range([height - margin.bottom, margin.top]);

  // 5) Draw
  const svg = d3.select(sel).html("").append("svg")
    .attr("width", width)
    .attr("height", height);

  // grid (horizontal)
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y)
      .ticks(5)
      .tickSize(-(width - margin.left - margin.right))
      .tickFormat(""))
    .selectAll("line")
    .attr("opacity", 0.35);

  // bars
  const bar = svg.append("g")
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
        const lo = fmt(Math.round(d.x0));
        const hi = fmt(Math.round(d.x1));
        tip.style("opacity", 1)
          .html(`<strong>Bin:</strong> ${lo} – ${hi}<br/><strong>Countries:</strong> ${d.length}`)
          .style("left", (ev.pageX) + "px")
          .style("top", (ev.pageY) + "px");
      })
      .on("mouseleave", () => tip.style("opacity", 0));

  // axes
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6, "~s"));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5));

  // x-axis label
  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (margin.left + (width - margin.right)) / 2)
    .attr("y", height - margin.bottom + 48)
    .text("Total conflict-related deaths per country");

  // caption note (optional inline)
  d3.select(sel).append("div").attr("class", "caption")
    .text(`Histogram for ${year}. Values above the 99th percentile are clipped to improve readability.`);
}

/* 7) Violin plot — country-level distribution by conflict type (snapshot year)*/
function drawViolin(sel, data, year) {
  // 1) Filter one row per country for the selected year (exclude aggregates/zeroes)
  const rows = data.filter(d => d.year === year && isISO3(d.code) && d.total > 0);
  if (!rows.length) { alertIn(sel, `No data available for ${year}.`); return; }

  // Tidy structure: one array of positive values per conflict type
  const tidy = TYPE_ORDER.map(k => ({
    key: k,
    values: rows.map(r => r[k]).filter(v => v > 0)
  }));
  if (tidy.every(d => d.values.length === 0)) {
    alertIn(sel, `No positive values by type in ${year}.`);
    return;
  }

  // 2) Global 99th percentile used to clip the right tail for density rendering only
  const allVals = tidy.flatMap(d => d.values).sort(d3.ascending);
  const q99 = d3.quantile(allVals, 0.99) || d3.max(allVals) || 1;

  // 3) Layout & scales
  const width  = 900;
  const height = 400;
  const margin = { top: 10, right: 30, bottom: 90, left: 110 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // x-scale in absolute units (same for all violins)
  const x = d3.scaleLinear()
    .domain([0, q99]).nice()
    .range([margin.left, width - margin.right]);

  // y-scale as bands (one row per conflict type)
  const y = d3.scaleBand()
    .domain(TYPE_ORDER)
    .range([margin.top, height - margin.bottom])
    .padding(0.25);

  // Light horizontal grid
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y)
      .tickSize(-(width - margin.left - margin.right))
      .tickFormat(""))
    .selectAll("line")
    .attr("opacity", 0.25);

  // 4) KDE helpers (Scott’s rule, Epanechnikov kernel)
  const bandwidth = (arr) => {
    const sd = d3.deviation(arr) || 1;
    const n  = Math.max(1, arr.length);
    return 1.06 * sd * Math.pow(n, -1/5);
  };
  const epanechnikov = k => v => {
    const u = v / k;
    return Math.abs(u) <= 1 ? 0.75 * (1 - u*u) / k : 0;
  };
  const thresholds = x.ticks(100);  // resolution of the density curve

  // 5) Draw each violin (symmetric area) + IQR line + median dot
  tidy.forEach(d => {
    if (!d.values.length) return;

    // Values used for the density: clipped at q99 → keeps shapes readable
    const vals = d.values.map(v => Math.min(v, q99));

    // Kernel density estimation on the clipped values
    const h       = Math.max(0.5, bandwidth(vals));
    const kernel  = epanechnikov(h);
    const density = thresholds.map(t => [t, d3.mean(vals, v => kernel(t - v)) || 0]);

    // Map density height → half-width of the violin within the band
    const maxD   = d3.max(density, e => e[1]) || 1;
    const scaleW = d3.scaleLinear().domain([0, maxD]).range([0, y.bandwidth() / 2]);

    const cy   = y(d.key) + y.bandwidth() / 2;
    const area = d3.area()
      .x(e => x(e[0]))
      .y0(e => cy + scaleW(e[1]))
      .y1(e => cy - scaleW(e[1]))
      .curve(d3.curveCatmullRom);

    // Violin shape
    svg.append("path")
      .datum(density)
      .attr("fill", TYPE_COLORS(d.key))
      .attr("opacity", 0.65)
      .attr("stroke", "#333")
      .attr("stroke-width", 0.8)
      .attr("d", area)
      // Tooltip: compute stats on RAW (non-clipped) values → accurate quartiles
      .on("mousemove", (ev) => {
        const sValsRaw = d.values.slice().filter(v => v > 0).sort(d3.ascending);
        const q1  = d3.quantileSorted(sValsRaw, 0.25) || 0;
        const med = d3.quantileSorted(sValsRaw, 0.50) || 0;
        const q3  = d3.quantileSorted(sValsRaw, 0.75) || 0;
        const fmt = d3.format(",");
        tip.style("opacity", 1)
          .html(
            `<strong>${d.key}</strong><br/>
             n = ${sValsRaw.length}<br/>
             Q1–Median–Q3: ${fmt(Math.round(q1))} – ${fmt(Math.round(med))} – ${fmt(Math.round(q3))}`
          )
          .style("left", (ev.pageX) + "px")
          .style("top",  (ev.pageY) + "px");
      })
      .on("mouseleave", () => tip.style("opacity", 0));

    // IQR line + median dot drawn from the (clipped) values used in the shape
    const sVals = vals.slice().sort(d3.ascending);
    const q1  = d3.quantileSorted(sVals, 0.25) || 0;
    const med = d3.quantileSorted(sVals, 0.50) || 0;
    const q3  = d3.quantileSorted(sVals, 0.75) || 0;

    svg.append("line")
      .attr("x1", x(q1)).attr("x2", x(q3))
      .attr("y1", cy).attr("y2", cy)
      .attr("stroke", "#111").attr("stroke-width", 2);

    svg.append("circle")
      .attr("cx", x(med)).attr("cy", cy)
      .attr("r", 3.2)
      .attr("fill", "#fff")
      .attr("stroke", "#111").attr("stroke-width", 1);
  });

  // 6) Axes
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6, "~s"));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  // 7) X-axis label (placed low enough not to be clipped by the card)
  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (width + margin.left) / 2)
    .attr("y", height - margin.bottom + 58)
    .attr("text-anchor", "middle")
    .text("Deaths per country");
}

/* 8) Boxplot — country-level distribution by conflict type (snapshot year) */
function drawBoxplot(sel, data, year) {
  // 1) Filter: include only valid ISO3 countries with positive values
  const rows = data.filter(d => d.year === year && isISO3(d.code) && d.total > 0);
  if (!rows.length) { alertIn(sel, `No data available for ${year}.`); return; }

  const tidy = TYPE_ORDER.map(k => ({
    key: k,
    values: rows.map(r => r[k]).filter(v => v > 0)
  }));
  if (tidy.every(d => d.values.length === 0)) {
    alertIn(sel, `No positive values by type in ${year}.`);
    return;
  }

  // 2) Define a shared x-domain (cut at 99th percentile for readability)
  const allVals = tidy.flatMap(d => d.values).sort(d3.ascending);
  const q99 = d3.quantile(allVals, 0.99) || d3.max(allVals) || 1;

  // 3) Basic layout and scales
  const width = 900, height = 360;
  const margin = { top: 10, right: 30, bottom: 70, left: 110 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3.scaleLinear()
    .domain([0, q99]).nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(TYPE_ORDER)
    .range([margin.top, height - margin.bottom])
    .padding(0.35);

  // 4) Light horizontal grid lines
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickSize(-(width - margin.left - margin.right)).tickFormat(""))
    .selectAll("line").attr("opacity", 0.25);

  // 5) Compute Tukey boxplot statistics per conflict type
  const stats = tidy.map(d => {
    const s = d.values.slice().sort(d3.ascending);
    if (!s.length) {
      return { key: d.key, n: 0, q1: 0, med: 0, q3: 0, low: 0, high: 0, outliers: [] };
    }
    const q1  = d3.quantileSorted(s, 0.25) || 0;
    const med = d3.quantileSorted(s, 0.50) || 0;
    const q3  = d3.quantileSorted(s, 0.75) || 0;
    const iqr = q3 - q1;

    const fenceLow  = q1 - 1.5 * iqr;
    const fenceHigh = q3 + 1.5 * iqr;
    const inside = s.filter(v => v >= fenceLow && v <= fenceHigh);
    const low  = inside.length ? d3.min(inside) : q1;
    const high = inside.length ? d3.max(inside) : q3;
    const outliers = s.filter(v => v < fenceLow || v > fenceHigh);

    return { key: d.key, n: s.length, q1, med, q3, low, high, outliers };
  });

  const fmt = d3.format(",");

  // Tooltip summary function
  const showSummary = (ev, d) => {
    tip.style("opacity", 1)
      .html(
        `<strong>${d.key}</strong><br/>
         n = ${d.n}<br/>
         Q1–Median–Q3: ${fmt(Math.round(d.q1))} – ${fmt(Math.round(d.med))} – ${fmt(Math.round(d.q3))}<br/>
         Whiskers: ${fmt(Math.round(d.low))} – ${fmt(Math.round(d.high))}`
      )
      .style("left", (ev.pageX) + "px")
      .style("top",  (ev.pageY) + "px");
  };

  // 6) Drawing phase
  const g = svg.append("g");
  const boxH = Math.min(28, y.bandwidth());

  // 6a) Transparent hit band for reliable hover detection (even for tiny boxes)
  g.selectAll("rect.hit").data(stats).join("rect")
    .attr("class", "hit")
    .attr("x", x(0))
    .attr("y", d => y(d.key))
    .attr("width", (width - margin.right) - x(0))
    .attr("height", y.bandwidth())
    .attr("fill", "transparent")
    .on("mousemove", showSummary)
    .on("mouseleave", () => tip.style("opacity", 0));

  // 6b) Whiskers
  g.selectAll("line.whisker").data(stats).join("line")
    .attr("class", "whisker")
    .attr("x1", d => x(Math.min(d.low,  q99)))
    .attr("x2", d => x(Math.min(d.high, q99)))
    .attr("y1", d => y(d.key) + y.bandwidth() / 2)
    .attr("y2", d => y(d.key) + y.bandwidth() / 2)
    .attr("stroke", "#7c818b");

  // Whisker caps
  g.selectAll("line.cap-low").data(stats).join("line")
    .attr("x1", d => x(Math.min(d.low, q99)))
    .attr("x2", d => x(Math.min(d.low, q99)))
    .attr("y1", d => y(d.key) + (y.bandwidth() - boxH) / 2)
    .attr("y2", d => y(d.key) + (y.bandwidth() + boxH) / 2)
    .attr("stroke", "#7c818b");

  g.selectAll("line.cap-high").data(stats).join("line")
    .attr("x1", d => x(Math.min(d.high, q99)))
    .attr("x2", d => x(Math.min(d.high, q99)))
    .attr("y1", d => y(d.key) + (y.bandwidth() - boxH) / 2)
    .attr("y2", d => y(d.key) + (y.bandwidth() + boxH) / 2)
    .attr("stroke", "#7c818b");

  // 6c) Boxes (Q1–Q3)
  g.selectAll("rect.box").data(stats).join("rect")
    .attr("class", "box")
    .attr("x", d => x(Math.min(d.q1, q99)))
    .attr("y", d => y(d.key) + (y.bandwidth() - boxH) / 2)
    .attr("width", d => Math.max(0, x(Math.min(d.q3, q99)) - x(Math.min(d.q1, q99))))
    .attr("height", boxH)
    .attr("fill", d => TYPE_COLORS(d.key))
    .attr("fill-opacity", 0.28)
    .attr("stroke", d => d3.color(TYPE_COLORS(d.key)).darker(0.8))
    .attr("stroke-width", 1.2)
    .on("mousemove", showSummary)
    .on("mouseleave", () => tip.style("opacity", 0));

  // 6d) Median line
  g.selectAll("line.median").data(stats).join("line")
    .attr("class", "median")
    .attr("x1", d => x(Math.min(d.med, q99)))
    .attr("x2", d => x(Math.min(d.med, q99)))
    .attr("y1", d => y(d.key) + (y.bandwidth() - boxH) / 2)
    .attr("y2", d => y(d.key) + (y.bandwidth() + boxH) / 2)
    .attr("stroke", "#111")
    .attr("stroke-width", 2);

  // 6e) Outlier points (slightly jittered vertically)
  g.selectAll("g.outliers").data(stats).join("g")
    .attr("class", "outliers")
    .each(function(d) {
      d3.select(this).selectAll("circle")
        .data(d.outliers)
        .join("circle")
          .attr("cx", v => x(Math.min(v, q99)))
          .attr("cy", y(d.key) + y.bandwidth() / 2 + (Math.random() - 0.5) * (boxH * 0.6))
          .attr("r", 2.2)
          .attr("fill", "#555")
          .attr("fill-opacity", 0.5)
          .on("mousemove", (ev, v) => {
            tip.style("opacity", 1)
              .html(`<strong>${d.key}</strong><br/>Outlier: ${fmt(Math.round(v))}`)
              .style("left", (ev.pageX) + "px")
              .style("top",  (ev.pageY) + "px");
          })
          .on("mouseleave", () => tip.style("opacity", 0));
    });

  // 7) Axes
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6, "~s"));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  // 8) X-axis label
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

  // Keep one row per year, ordered in time
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
    .domain([0, d3.max(totals) || 1]).nice()
    .range([height - margin.bottom, margin.top]);

  // Horizontal grid lines to help reading the trend
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

  // Line generator
  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.total))
    .curve(d3.curveMonotoneX);

  // Main line
  svg.append("path")
    .datum(rows)
    .attr("fill", "none")
    .attr("stroke", "#4f7df3")
    .attr("stroke-width", 2.4)
    .attr("d", line);

  // Small circles on each year for better hover targets
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
        tip.style("opacity", 1)
          .html(
            `<strong>${d.year}</strong><br/>` +
            `${fmt(Math.round(d.total))} deaths`
          )
          .style("left", ev.pageX + "px")
          .style("top", ev.pageY + "px");
      })
      .on("mouseleave", () => tip.style("opacity", 0));

  // Axes
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

  // X-axis label
  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (margin.left + (width - margin.right)) / 2)
    .attr("y", height - margin.bottom + 40)
    .text("Year");

  // Y-axis label: ancorata a margin.left
  const centerY = (margin.top + (height - margin.bottom)) / 2;

  svg.append("text")
    .attr("class", "axis-label")
    .attr(
      "transform",
      `translate(${margin.left - 60}, ${centerY}) rotate(-90)`
    )
    .attr("text-anchor", "middle")
    .text("Conflict-related deaths (World total)");
}

/* 10) Choropleth map — total conflict-related deaths per country (snapshot year) */
function drawChoropleth(sel, worldGeoJSON, dataRows, year) {
  // 1) Filter one row per ISO3 country for the selected year
  const rows = dataRows.filter(d => d.year === year && isISO3(d.code));
  if (!rows.length) {
    alertIn(sel, `No country data for year ${year}.`);
    return;
  }

  // Lookup table: ISO3 -> total deaths in that year
  const valueByISO = {};
  rows.forEach(d => {
    const iso = d.code;          // ISO3 from the CSV
    const val = +d.total;
    if (!isNaN(val)) valueByISO[iso] = val;
  });

  const positiveValues = Object.values(valueByISO).filter(v => v > 0);
  const maxVal = d3.max(positiveValues) || 1;

  const width  = 900;
  const height = 420;
  const marginBottom = 40;

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Hide tooltip when leaving the whole map area
  d3.select(sel).on("mouseleave", () => {
    tip.style("opacity", 0);
  });

  // 2) Projection and path generator
  const projection = d3.geoNaturalEarth1()
    .fitSize([width, height - marginBottom - 10], worldGeoJSON);
  const path = d3.geoPath(projection);

  // 3) Log color scale (only positive values)
  const color = d3.scaleSequentialLog()
    .domain([1, maxVal])
    .interpolator(d3.interpolateOrRd);

  // 4) Draw countries
  svg.append("g")
    .selectAll("path")
    .data(worldGeoJSON.features)
    .join("path")
      .attr("d", path)
      .attr("fill", d => {
        const iso = d.properties.iso_a3;   // ISO3 from GeoJSON
        const val = valueByISO[iso];
        return val > 0 ? color(val) : "#e5e7eb";  // light grey for 0/undefined
      })
      .attr("stroke", "#9ca3af")
      .attr("stroke-width", 0.4)
      .on("mousemove", (ev, d) => {
        const iso  = d.properties.iso_a3;
        const name = d.properties.name;
        const val  = valueByISO[iso];
        let html;

        if (val === undefined) {
          html = `<strong>${name}</strong><br/>No data in this dataset in ${year}`;
        } else if (val === 0) {
          html = `<strong>${name}</strong><br/>0 conflict-related deaths in ${year}`;
        } else {
          html = `<strong>${name}</strong><br/>${d3.format(",")(val)} deaths in ${year}`;
        }

        tip.style("opacity", 1)
          .html(html)
          .style("left", ev.pageX + "px")
          .style("top",  ev.pageY + "px");
      })
      .on("mouseleave", () => {
        tip.style("opacity", 0);
      });

  // 5) Color legend (log scale)
  const legendWidth  = 260;
  const legendHeight = 10;

  const legendGroup = svg.append("g")
    .attr(
      "transform",
      `translate(${(width - legendWidth) / 2}, ${height - marginBottom + 12})`
    );

  // Gradient definition — directly use the OrRd interpolator on t ∈ [0,1]
  const defs = svg.append("defs");
  const gradient = defs.append("linearGradient")
    .attr("id", "choropleth-gradient");

  const stops = 10;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops; // 0 → 1
    gradient.append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", d3.interpolateOrRd(t));
  }

  legendGroup.append("rect")
    .attr("width",  legendWidth)
    .attr("height", legendHeight)
    .attr("fill", "url(#choropleth-gradient)");

  // Log scale only for the tick labels
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
