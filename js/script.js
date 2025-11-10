/*******************************************************
 * Visualizing Conflict and Human Suffering — JS bundle
 * Datasets: UCDP via Our World in Data
 * Charts (comparison category):
 *  1) Top-10 barchart (absolute)            → #bar-top10
 *  2) Grouped barchart (selected countries) → #grouped
 *  3) Heatmap (World totals, type × year)   → #heatmap
 *  4) 100% stacked barchart (World shares)  → #stack100
 *  5) Waffle chart (World composition Y)    → #waffle
 *******************************************************/

/* ---------- Config ---------- */
const DATA_PATH = "data/conflict_deaths_by_type.csv"; // must match repo path
const SNAPSHOT_YEAR = 2023;
const FOCUS_COUNTRIES = ["Ukraine","Palestine","Sudan","Mexico","Burkina Faso"];

const TYPE_ORDER = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(TYPE_ORDER)
  .range(["#6c8ae4","#f28e2b","#edc948","#59a14f","#e15759"]);

/* ---------- Shared tooltip ---------- */
const tip = d3.select("body")
  .append("div")
  .attr("class","tooltip")
  .style("opacity", 0);

/* ---------- Utilities ---------- */

// Show a friendly alert inside a target container
function alertIn(sel, msg){
  const box = d3.select(sel);
  if (!box.empty()){
    box.html("").append("div").attr("class","alert").text(msg);
  }
}

// ISO3 guard (filters out regions/aggregates)
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

// Heuristic header detection (robust to long OWID names, hyphens, spaces)
function detectColumns(headers){
  const norm = s => s.toLowerCase()
    .replace(/[–—−-]/g, "-")     // varianti di trattino
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

    // colonne OWID: "… - Conflict type: interstate", ecc.
    interstate:    pick("conflict type: interstate", " interstate"),
    intrastate:    pick("conflict type: intrastate", " intrastate"),
    extrasystemic: pick("conflict type: extrasystemic", " extrasystemic"),
    nonstate:      pick("conflict type: non-state", " non state", " non-state conflict"),
    onesided:      pick("conflict type: one-sided", " one-sided violence", " one sided"),
  };
}

// Row mapping → normalized field names
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
  return r;
}

/* ---------- Data load + dispatch ---------- */
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw?.length) throw new Error("CSV is empty.");

  const headers = Object.keys(raw[0]);
  const C = detectColumns(headers);

  const required = [C.entity, C.code, C.year, C.intrastate, C.nonstate, C.onesided];
  if (required.some(x => !x)) {
    alertIn("#bar-top10", "Could not detect required columns in the CSV.");
    alertIn("#grouped",  "Could not detect required columns in the CSV.");
    alertIn("#heatmap",  "Could not detect required columns in the CSV.");
    alertIn("#stack100", "Could not detect required columns in the CSV.");
    alertIn("#waffle",   "Could not detect required columns in the CSV.");
    return;
  }

  const rows      = raw.map(d => mapRow(d, C));
  const countries = rows.filter(r => isISO3(r.code) && r.entity !== "World");
  const worldOnly = rows.filter(r => r.entity === "World");

  // Update year labels in the page
  d3.select("#year-top").text(SNAPSHOT_YEAR);
  d3.select("#year-grouped").text(SNAPSHOT_YEAR);
  d3.select("#year-waffle").text(SNAPSHOT_YEAR);
  d3.select("#waffle-year").text(SNAPSHOT_YEAR);

  // 1) Top-10
  drawTop10Bar("#bar-top10", countries, SNAPSHOT_YEAR);

  // 2) Grouped (selected countries)
  drawGroupedByType("#grouped", countries, SNAPSHOT_YEAR, FOCUS_COUNTRIES);

  // 3) Heatmap (World only)
  drawWorldHeatmap("#heatmap", worldOnly);

  // 4) 100% stacked shares (World over time)
  drawStacked100("#stack100", worldOnly);

  // 5) Waffle (World composition for SNAPSHOT_YEAR)
  drawWaffle("#waffle", worldOnly, SNAPSHOT_YEAR);

  // 6) Histogram (distributions section)
  drawHistogram("#histogram", countries, SNAPSHOT_YEAR);
  
  // 7) Violin plot
  drawViolin("#violin", countries, SNAPSHOT_YEAR);

}).catch(err => {
  console.error(err);
  ["#bar-top10","#grouped","#heatmap","#stack100","#waffle"].forEach(sel =>
    alertIn(sel, "Failed to load the CSV. Make sure it is at data/conflict_deaths_by_type.csv")
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

  // barre
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

  // assi
  svg.append("g").attr("class","axis")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(years.filter(y => y%2===0)));

  svg.append("g").attr("class","axis")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickValues([0,.25,.5,.75,1]).tickFormat(d3.format(".0%")));

  // legenda (pill) sotto il grafico
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
  const margin = { top: 10, right: 22, bottom: 50, left: 56 };

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
    .attr("y", height - margin.bottom + 34)
    .text("Total conflict-related deaths per country");

  // caption note (optional inline)
  d3.select(sel).append("div").attr("class", "caption")
    .text(`Histogram for ${year}. Values above the 99th percentile are clipped to improve readability.`);
}

/* 7) Violin plot — robusto + median/IQR + log diagnostico */
function drawViolin(sel, data, year) {
  const rows = data.filter(d => d.year === year && isISO3(d.code) && d.total > 0);
  if (!rows.length) { alertIn(sel, `No data available for ${year}.`); return; }

  const tidy = TYPE_ORDER.map(k => ({
    key: k,
    values: rows.map(r => r[k]).filter(v => Number.isFinite(v) && v > 0)
  }));
  console.log("[violin] year=", year, "counts per type=", tidy.map(t => [t.key, t.values.length]));

  // Se TUTTI i tipi sono vuoti, mostro un avviso e esco
  if (tidy.every(t => t.values.length === 0)) {
    alertIn(sel, `No per-type values > 0 in ${year}.`);
    return;
  }

  const width = 900, height = 400;
  const margin = { top: 10, right: 30, bottom: 60, left: 100 };

  const svg = d3.select(sel).html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const globalMax = d3.max(tidy.flatMap(d => d.values)) || 1;
  const x = d3.scaleLinear()
    .domain([0, globalMax])
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(TYPE_ORDER)
    .range([margin.top, height - margin.bottom])
    .padding(0.25);

  // KDE helpers
  const epanechnikov = k => v => {
    v /= k;
    return Math.abs(v) <= 1 ? 0.75 * (1 - v * v) / k : 0;
  };
  const kde = (kernel, thresholds, data) =>
    thresholds.map(t => [t, d3.mean(data, d => kernel(t - d))]);

  const thresholds = x.ticks(60);

  tidy.forEach(d => {
    if (!d.values.length) return;

    // bandwidth robusta (con minimo > 0)
    const sd = d3.deviation(d.values) || 0;
    const span = (d3.max(d.values) - d3.min(d.values)) || 0;
    const bw = Math.max(1, sd > 0 ? 0.4 * sd : span > 0 ? span / 6 : globalMax / 20);
    console.log(`[violin] ${d.key}: sd=${sd}, span=${span}, bw=${bw}`);

    const density = kde(epanechnikov(bw), thresholds, d.values);
    const maxY = d3.max(density, e => e[1]) || 1;
    const scaleY = d3.scaleLinear().domain([0, maxY]).range([0, y.bandwidth() / 2]);

    const areaTop = d3.area()
      .x(e => x(e[0]))
      .y0(y(d.key) + y.bandwidth() / 2)
      .y1(e => y(d.key) + y.bandwidth() / 2 - scaleY(e[1]))
      .curve(d3.curveCatmullRom);

    const areaBottom = d3.area()
      .x(e => x(e[0]))
      .y0(y(d.key) + y.bandwidth() / 2)
      .y1(e => y(d.key) + y.bandwidth() / 2 + scaleY(e[1]))
      .curve(d3.curveCatmullRom);

    svg.append("path")
      .datum(density)
      .attr("fill", TYPE_COLORS(d.key))
      .attr("opacity", 0.6)
      .attr("stroke", "#333")
      .attr("stroke-width", 0.8)
      .attr("d", areaTop);

    svg.append("path")
      .datum(density)
      .attr("fill", TYPE_COLORS(d.key))
      .attr("opacity", 0.6)
      .attr("stroke", "#333")
      .attr("stroke-width", 0.8)
      .attr("d", areaBottom);

    // Quartili + mediana
    const sorted = d.values.slice().sort(d3.ascending);
    const q1 = d3.quantileSorted(sorted, 0.25) || 0;
    const med = d3.quantileSorted(sorted, 0.50) || 0;
    const q3 = d3.quantileSorted(sorted, 0.75) || 0;

    svg.append("line")
      .attr("x1", x(q1))
      .attr("x2", x(q3))
      .attr("y1", y(d.key) + y.bandwidth() / 2)
      .attr("y2", y(d.key) + y.bandwidth() / 2)
      .attr("stroke", "#000")
      .attr("stroke-width", 2);

    svg.append("circle")
      .attr("cx", x(med))
      .attr("cy", y(d.key) + y.bandwidth() / 2)
      .attr("r", 4)
      .attr("fill", "#fff")
      .attr("stroke", "#000");
  });

  // Assi
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6, "~s"));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  svg.append("text")
    .attr("x", (width + margin.left) / 2)
    .attr("y", height - 10)
    .attr("text-anchor", "middle")
    .attr("class", "axis-label")
    .text("Deaths per country");
}
