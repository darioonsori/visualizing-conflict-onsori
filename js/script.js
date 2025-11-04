/*******************************************************
 * Robust loading + five charts (Top10, Grouped, Heatmap,
 * 100% Stacked, Waffle)
 * Dataset path MUST match the repo: data/conflict_deaths_by_type.csv
 *******************************************************/
const DATA_PATH = "data/conflict_deaths_by_type.csv";
const SNAPSHOT_YEAR = 2023;
const FOCUS_COUNTRIES = ["Ukraine","Palestine","Sudan","Mexico","Burkina Faso"];

const TYPE_COLORS = d3.scaleOrdinal()
  .domain(["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"])
  .range(["#6c8ae4","#f28e2b","#edc948","#59a14f","#e15759"]);

const tip = d3.select("body").append("div").attr("class","tooltip").style("opacity",0);

// Small helper to print an alert inside a container on failure
function alertIn(sel, msg){
  const box = d3.select(sel);
  if (!box.empty()){
    box.html("").append("div").attr("class","alert").text(msg);
  }
}

// --- ISO3 validator
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

// --- Column detection tolerant to case/spacing
function detectColumns(headers){
  const low = headers.map(h => h.toLowerCase());
  const find = kw => headers[low.findIndex(x => x.includes(kw))];
  const cols = {
    entity:        find("entity")      || "Entity",
    code:          find("code")        || "Code",
    year:          find("year")        || "Year",
    interstate:    find("conflict type: interstate"),
    intrastate:    find("conflict type: intrastate"),
    extrasystemic: find("conflict type: extrasystemic"),
    nonstate:      find("conflict type: non-state"),
    onesided:      find("conflict type: one-sided")
  };
  return cols;
}

function mapRow(d, C){
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
  r.total = r.Interstate + r.Intrastate + r.Extrasystemic + r["Non-state"] + r["One-sided"];
  return r;
}

// ---------- Load CSV (with diagnostics)
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  console.info("[CSV] Loaded rows:", raw.length);
  if (!raw?.length) throw new Error("CSV is empty.");

  const headers = Object.keys(raw[0]);
  console.info("[CSV] Headers:", headers);
  const C = detectColumns(headers);

  // Sanity for required columns
  const required = [C.entity, C.code, C.year, C.intrastate, C.nonstate, C.onesided];
  if (required.some(x => !x)) {
    console.error("[CSV] Missing expected columns mapping:", C);
    ["#bar-top10","#grouped","#heatmap","#stacked100","#waffle"].forEach(sel =>
      alertIn(sel, "Could not detect needed columns in the CSV. Check header names.")
    );
    return;
  }

  const rows = raw.map(d => mapRow(d, C));
  const countries = rows.filter(r => isISO3(r.code) && r.entity !== "World");
  const worldOnly = rows.filter(r => r.entity === "World")
                        .sort((a,b) => a.year - b.year);

  console.info("[Prep] Countries:", countries.length, "World rows:", worldOnly.length);

  // Existing charts
  d3.select("#year-top").text(SNAPSHOT_YEAR);
  drawTop10Bar("#bar-top10", countries, SNAPSHOT_YEAR);

  d3.select("#year-grouped").text(SNAPSHOT_YEAR);
  drawGroupedByType("#grouped", countries, SNAPSHOT_YEAR, FOCUS_COUNTRIES);

  drawWorldHeatmap("#heatmap", worldOnly);

  // NEW: 100% stacked + waffle
  drawStacked100("#stacked100", worldOnly);
  d3.select("#year-waffle").text(SNAPSHOT_YEAR);
  drawWaffle("#waffle", worldOnly, SNAPSHOT_YEAR);

  // legends for color-based charts
  renderLegend("#legend-grouped");
  renderLegend("#legend-stacked");
  renderLegend("#legend-waffle");

}).catch(err => {
  console.error(err);
  ["#bar-top10","#grouped","#heatmap","#stacked100","#waffle"].forEach(sel =>
    alertIn(sel, "Failed to load the CSV. Ensure the file exists at data/conflict_deaths_by_type.csv")
  );
});

/* ===================== CHARTS ===================== */

// 1) Top-10 bar
function drawTop10Bar(sel, data, year){
  const rows = data.filter(d => d.year === year && d.total > 0);
  if (!rows.length){ alertIn(sel, `No country data for year ${year}.`); return; }

  const top10 = rows.sort((a,b)=>d3.descending(a.total,b.total)).slice(0,10);
  const width=900, height=360, margin={top:10,right:28,bottom:44,left:220};
  const svg = d3.select(sel).html("").append("svg").attr("width",width).attr("height",height);

  const x = d3.scaleLinear().domain([0, d3.max(top10,d=>d.total)||1]).nice()
    .range([margin.left, width-margin.right]);
  const y = d3.scaleBand().domain(top10.map(d=>d.entity))
    .range([margin.top, height-margin.bottom]).padding(0.18);

  // grid
  svg.append("g").attr("class","grid")
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
      tip.style("opacity",1).html(`<strong>${d.entity}</strong><br/>${d3.format(",")(d.total)} deaths`)
         .style("left", (ev.pageX)+"px").style("top",(ev.pageY)+"px");
    }).on("mouseleave",()=> tip.style("opacity",0));

  // value labels (robust near the right edge)
  const fmt = d3.format(",");
  const EDGE_PAD = 84;
  svg.append("g").selectAll("text.value").data(top10).join("text")
    .attr("class","value")
    .attr("y", d=> y(d.entity)+y.bandwidth()/2)
    .attr("dy","0.32em")
    .text(d => fmt(d.total))
    .attr("x", d=>{
      const xr=x(d.total); return (width-margin.right-xr)<EDGE_PAD ? xr-6 : xr+6;
    })
    .attr("text-anchor", d=> (width-margin.right-x(d.total))<EDGE_PAD ? "end" : "start")
    .attr("fill", d=> (width-margin.right-x(d.total))<EDGE_PAD ? "white" : "#111827")
    .style("font-size","12px");
}

// 2) Grouped bar (selected countries × type)
function drawGroupedByType(sel, data, year, focus){
  const keys = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
  const rows = data.filter(d => d.year===year && focus.includes(d.entity));
  if (!rows.length){ alertIn(sel, `No data for selected countries in ${year}.`); return; }

  const groups = focus.filter(c => rows.some(r => r.entity===c));
  const tidy = groups.map(g => {
    const d = rows.find(r => r.entity===g);
    return { group:g, values: keys.map(k => ({key:k, value:d?d[k]:0})) };
  });

  const width=900, height=360, margin={top:10,right:24,bottom:62,left:56};
  const svg = d3.select(sel).html("").append("svg").attr("width",width).attr("height",height);

  const x0 = d3.scaleBand().domain(groups).range([margin.left, width-margin.right]).padding(0.22);
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.08);
  const y  = d3.scaleLinear().domain([0, d3.max(tidy.flatMap(t=>t.values), d=>d.value)||1]).nice()
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
        tip.style("opacity",1).html(`<strong>${d.key}</strong><br/>${d3.format(",")(d.value)} deaths`)
           .style("left",(ev.pageX)+"px").style("top",(ev.pageY)+"px");
     }).on("mouseleave",()=> tip.style("opacity",0));
}

// 3) Heatmap (World only)
function drawWorldHeatmap(sel, worldRows){
  if (!worldRows.length){ alertIn(sel, "No World aggregate rows found."); return; }

  const keys = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
  const years = worldRows.map(d=>d.year).sort((a,b)=>a-b);
  const cells = [];
  worldRows.forEach(d => keys.forEach(k => cells.push({row:k, col:d.year, value:d[k]})));

  const width=900, height=280, margin={top:28,right:18,bottom:34,left:110};
  const svg = d3.select(sel).html("").append("svg").attr("width",width).attr("height",height);

  const x = d3.scaleBand().domain(years).range([margin.left, width-margin.right]).padding(0);
  const y = d3.scaleBand().domain(keys).range([margin.top, height-margin.bottom]).padding(0.06);

  const max = d3.max(cells, d=>d.value)||1;
  const color = d3.scaleSequential(d3.interpolateOrRd).domain([0,max]);

  svg.append("g").selectAll("rect").data(cells).join("rect")
    .attr("x", d=>x(d.col)).attr("y", d=>y(d.row))
    .attr("width", x.bandwidth()).attr("height", y.bandwidth())
    .attr("fill", d=>color(d.value))
    .on("mousemove",(ev,d)=>{
      tip.style("opacity",1).html(`<strong>${d.row}</strong> — ${d.col}<br/>${d3.format(",")(d.value)} deaths`)
         .style("left",(ev.pageX)+"px").style("top",(ev.pageY)+"px");
    }).on("mouseleave",()=> tip.style("opacity",0));

  const xticks = years.filter(y => y%4===0 || y===years[0] || y===years.at(-1));
  svg.append("g").attr("class","axis")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(xticks).tickSize(0));
  svg.append("g").attr("class","axis")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickSize(0));

// legend gradient + title
const legendW = 220, legendH = 10, lx = width - legendW - 18, ly = margin.top - 18;
const defs = svg.append("defs");
const grad = defs.append("linearGradient").attr("id", "hm-grad");
grad.append("stop").attr("offset", "0%").attr("stop-color", color(0));
grad.append("stop").attr("offset", "100%").attr("stop-color", color(max));

// gradient bar
svg.append("rect")
  .attr("x", lx)
  .attr("y", ly)
  .attr("width", legendW)
  .attr("height", legendH)
  .attr("fill", "url(#hm-grad)");

// legend axis
const s = d3.scaleLinear().domain([0, max]).range([lx, lx + legendW]);
svg.append("g")
  .attr("class", "axis")
  .attr("transform", `translate(0,${ly + legendH})`)
  .call(d3.axisBottom(s).ticks(3).tickFormat(d3.format(",")));

// improved title position
svg.append("text")
  .attr("x", lx - 10)                // spostata più a sinistra
  .attr("y", ly - 10)                // più in alto rispetto alla barra
  .attr("text-anchor", "start")      // allineata a sinistra
  .attr("fill", "#2d2d2d")           // colore più contrastato
  .attr("font-size", "12px")
  .text("Number of deaths (log scale)");

// 4) 100% stacked bar (World shares by year)
function drawStacked100(sel, worldRows){
  if (!worldRows.length){ alertIn(sel, "No World aggregate rows found."); return; }

  const keys = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
  // Prepare rows as proportions per year
  const data = worldRows.map(d => {
    const t = d.total || 1;
    const o = {year:d.year};
    keys.forEach(k => { o[k] = (d[k]||0)/t; });
    return o;
  });

  const width=900, height=300, margin={top:10,right:20,bottom:40,left:56};
  const svg = d3.select(sel).html("").append("svg").attr("width",width).attr("height",height);

  const x = d3.scaleBand().domain(data.map(d=>d.year)).range([margin.left, width-margin.right]).padding(0.1);
  const y = d3.scaleLinear().domain([0,1]).range([height-margin.bottom, margin.top]);

  const stack = d3.stack().keys(keys).offset(d3.stackOffsetExpand)(data);

  svg.append("g").selectAll("g").data(stack).join("g")
    .attr("fill", d => TYPE_COLORS(d.key))
    .selectAll("rect").data(d => d).join("rect")
      .attr("x", d => x(d.data.year))
      .attr("y", d => y(d[1]))
      .attr("height", d => Math.max(0, y(d[0]) - y(d[1])))
      .attr("width", x.bandwidth())
      .on("mousemove",(ev,d)=>{
        // find the key for this layer
        const key = d3.select(ev.currentTarget.parentNode).datum().key;
        const pct = d3.format(".0%")(d[1]-d[0]);
        tip.style("opacity",1).html(`<strong>${key}</strong> — ${d.data.year}<br/>${pct}`)
           .style("left",(ev.pageX)+"px").style("top",(ev.pageY)+"px");
      })
      .on("mouseleave",()=> tip.style("opacity",0));

  svg.append("g").attr("class","axis")
     .attr("transform",`translate(0,${height-margin.bottom})`)
     .call(d3.axisBottom(x).tickValues(x.domain().filter(y=>y%4===0)));
  svg.append("g").attr("class","axis")
     .attr("transform",`translate(${margin.left},0)`)
     .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
}

// 5) Waffle chart (World composition in snapshot year)
function drawWaffle(sel, worldRows, year){
  const w = worldRows.find(d => d.year === year) || worldRows.at(-1);
  if (!w){ alertIn(sel, "No World data for waffle."); return; }

  const parts = [
    {name:"Interstate", value:w.Interstate},
    {name:"Intrastate", value:w.Intrastate},
    {name:"Extrasystemic", value:w.Extrasystemic},
    {name:"Non-state", value:w["Non-state"]},
    {name:"One-sided", value:w["One-sided"]}
  ];
  const total = d3.sum(parts, d=>d.value)||1;
  const counts = parts.map(d => ({name:d.name, n: Math.round(100 * d.value / total)}));
  // normalize to 100 tiles
  let tiles = [];
  counts.forEach(c => { for (let i=0;i<c.n;i++) tiles.push({name:c.name}); });
  tiles = tiles.slice(0,100);

  const cols=10, rows=10, size=18, gap=2;
  const width = cols*(size+gap) + 20;
  const height = rows*(size+gap) + 12;

  const svg = d3.select(sel).html("").append("svg")
    .attr("width", width).attr("height", height);

  const g = svg.append("g").attr("transform","translate(10,6)");

  g.selectAll("rect").data(tiles).join("rect")
    .attr("class","waffle-tile")
    .attr("x",(d,i)=> (i%cols)*(size+gap))
    .attr("y",(d,i)=> Math.floor(i/cols)*(size+gap))
    .attr("width", size).attr("height", size)
    .attr("fill", d => TYPE_COLORS(d.name))
    .on("mousemove",(ev,d)=>{
      tip.style("opacity",1).html(d.name)
         .style("left",(ev.pageX)+"px").style("top",(ev.pageY)+"px");
    }).on("mouseleave",()=> tip.style("opacity",0));
}

/* ============== shared legend renderer ============== */
function renderLegend(sel){
  const root = d3.select(sel).html("");
  TYPE_COLORS.domain().forEach(k=>{
    const item = root.append("span").attr("class","pill");
    item.append("span").attr("class","swatch").style("background", TYPE_COLORS(k));
    item.append("span").text(k);
  });
}
