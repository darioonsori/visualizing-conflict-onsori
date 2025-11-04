/*********************************************************
 * Data + constants
 *********************************************************/
const DATA_PATH = "data/conflict_deaths_by_type.csv";   // <-- lascia questo nome (come nel repo)
const SNAPSHOT_YEAR = 2023;                              // anno di riferimento per i grafici “per paese”
const FOCUS_COUNTRIES = ["Ukraine","Palestine","Sudan","Mexico","Burkina Faso"]; // grouped chart

// Color palette for conflict types (consistent across charts)
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"])
  .range(["#6c8ae4","#f28e2b","#edc948","#59a14f","#e15759"]);

// Simple tooltip (re-used)
const tip = d3.select("body").append("div").attr("class","tooltip").style("opacity",0);

/*********************************************************
 * Utilities
 *********************************************************/
// Heuristic to detect relevant OWID/UCDP column names
function detectColumns(headers){
  const h = headers.map(s => s.toLowerCase());
  const find = kw => headers[h.findIndex(x => x.includes(kw))];
  return {
    entity:       find("entity")      || "Entity",
    code:         find("code")        || "Code",
    year:         find("year")        || "Year",
    interstate:   find("conflict type: interstate"),
    intrastate:   find("conflict type: intrastate"),
    extrasystemic:find("conflict type: extrasystemic"),
    nonstate:     find("conflict type: non-state"),
    onesided:     find("conflict type: one-sided")
  };
}

// ISO3 validator: exactly 3 uppercase letters
const isISO3 = code => typeof code === "string" && /^[A-Z]{3}$/.test(code);

// Build tidy record with totals from a raw row
function mapRow(d, C) {
  const o = {
    entity: d[C.entity],
    code:   d[C.code],
    year:  +d[C.year],
    Interstate:   +d[C.interstate]   || 0,
    Intrastate:   +d[C.intrastate]   || 0,
    Extrasystemic:+d[C.extrasystemic]|| 0,
    "Non-state":  +d[C.nonstate]     || 0,
    "One-sided":  +d[C.onesided]     || 0
  };
  o.total = o.Interstate + o.Intrastate + o.Extrasystemic + o["Non-state"] + o["One-sided"];
  return o;
}

/*********************************************************
 * Load + prepare, then draw charts
 *********************************************************/
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw?.length) throw new Error("CSV empty or not loaded.");

  const C = detectColumns(Object.keys(raw[0]));
  const rows = raw.map(d => mapRow(d, C));

  // Subsets
  const countries = rows.filter(r => isISO3(r.code) && r.entity !== "World");
  const worldOnly  = rows.filter(r => r.entity === "World");

  // Top-10 bar (countries only)
  d3.select("#year-top").text(SNAPSHOT_YEAR);
  drawTop10Bar("#bar-top10", countries, SNAPSHOT_YEAR);

  // Grouped bar by type for selected countries (countries only)
  d3.select("#year-grouped").text(SNAPSHOT_YEAR);
  drawGroupedByType("#grouped", countries, SNAPSHOT_YEAR, FOCUS_COUNTRIES);

  // Heatmap World: type × year (use only the World aggregate)
  drawWorldHeatmap("#heatmap", worldOnly);

}).catch(err => console.error(err));

/*********************************************************
 * Chart 1 — Top-10 bar (countries only)
 *********************************************************/
function drawTop10Bar(sel, data, year) {
  const rows = data.filter(d => d.year === year && d.total > 0);
  const top10 = rows.sort((a,b)=> d3.descending(a.total,b.total)).slice(0,10);

  const width=900, height=360, margin={top:10,right:24,bottom:44,left:210};
  const svg = d3.select(sel).append("svg").attr("width",width).attr("height",height);

  const x = d3.scaleLinear()
    .domain([0, d3.max(top10, d=>d.total)||1]).nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(top10.map(d => d.entity))
    .range([margin.top, height - margin.bottom])
    .padding(0.18);

  // grid (light)
  svg.append("g")
    .attr("class","grid")
    .attr("transform",`translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickSize(-(height - margin.top - margin.bottom)).tickFormat(""));

  // axes
  svg.append("g")
    .attr("class","axis")
    .attr("transform",`translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format(",")));

  svg.append("g")
    .attr("class","axis")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  // bars
  svg.append("g")
    .selectAll("rect").data(top10).join("rect")
      .attr("x", x(0))
      .attr("y", d => y(d.entity))
      .attr("width", d => x(d.total)-x(0))
      .attr("height", y.bandwidth())
      .attr("fill", "#8da2fb")
      .on("mousemove", (ev,d)=>{
        tip.style("opacity",1)
           .html(`<strong>${d.entity}</strong><br/>${d3.format(",")(d.total)} deaths`)
           .style("left", (ev.pageX)+"px")
           .style("top",  (ev.pageY)+"px");
      })
      .on("mouseleave", ()=> tip.style("opacity",0));

  // value labels – robust near the right edge
  const format = d3.format(",");
  const EDGE_PAD = 72; // slightly wider “edge” for very long bars

  svg.append("g")
    .selectAll("text.value").data(top10).join("text")
      .attr("class","value")
      .attr("y", d => y(d.entity) + y.bandwidth()/2 )
      .attr("dy","0.32em")
      .text(d => format(d.total))
      .attr("x", d => {
         const xr = x(d.total);
         return (width - margin.right - xr) < EDGE_PAD ? xr - 6 : xr + 6;
      })
      .attr("text-anchor", d => (width - margin.right - x(d.total)) < EDGE_PAD ? "end" : "start")
      .attr("fill", d => (width - margin.right - x(d.total)) < EDGE_PAD ? "white" : "#111827")
      .style("font-size","12px");
}

/*********************************************************
 * Chart 2 — Grouped bar by conflict type (selected countries)
 *********************************************************/
function drawGroupedByType(sel, data, year, focusCountries){
  const keys = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
  const rows = data.filter(d => d.year === year && focusCountries.includes(d.entity));

  // Keep only countries that actually exist in this year, preserving FOCUS order
  const groups = focusCountries.filter(c => rows.some(r => r.entity === c));

  const tidy = groups.map(country => {
    const d = rows.find(r => r.entity === country);
    return {
      group: country,
      values: keys.map(k => ({ key: k, value: d ? d[k] : 0 }))
    };
  });

  const width=900, height=360, margin={top:10,right:24,bottom:62,left:56};
  const svg = d3.select(sel).append("svg").attr("width",width).attr("height",height);

  const x0 = d3.scaleBand().domain(groups).range([margin.left, width - margin.right]).padding(0.22);
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.08);
  const y  = d3.scaleLinear().domain([0, d3.max(tidy.flatMap(r => r.values), d=>d.value)||1]).nice()
                .range([height - margin.bottom, margin.top]);

  // axes
  svg.append("g").attr("class","axis")
     .attr("transform",`translate(0,${height - margin.bottom})`)
     .call(d3.axisBottom(x0))
     .selectAll("text").attr("transform","rotate(-18)").style("text-anchor","end");

  svg.append("g").attr("class","axis")
     .attr("transform",`translate(${margin.left},0)`)
     .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(",")));

  // bars
  const g = svg.append("g");
  g.selectAll("g").data(tidy).join("g")
     .attr("transform", d => `translate(${x0(d.group)},0)`)
   .selectAll("rect").data(d => d.values).join("rect")
     .attr("x", d => x1(d.key))
     .attr("y", d => y(d.value))
     .attr("width", x1.bandwidth())
     .attr("height", d => y(0) - y(d.value))
     .attr("fill", d => TYPE_COLORS(d.key))
     .on("mousemove",(ev,d)=>{
        tip.style("opacity",1)
           .html(`<strong>${d.key}</strong><br/>${d3.format(",")(d.value)} deaths`)
           .style("left", (ev.pageX)+"px")
           .style("top",  (ev.pageY)+"px");
     })
     .on("mouseleave", ()=> tip.style("opacity",0));

  // legend (pills)
  const legend = d3.select(sel).append("div").attr("class","legend");
  TYPE_COLORS.domain().forEach(k => {
    const item = legend.append("span").attr("class","pill");
    item.append("span").attr("class","swatch").style("background", TYPE_COLORS(k));
    item.append("span").text(k);
  });
}

/*********************************************************
 * Chart 3 — Heatmap World (type × year)
 *********************************************************/
function drawWorldHeatmap(sel, worldRows){
  // Build matrix: rows = types, cols = years
  const keys = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
  const years = worldRows.map(d => d.year).sort((a,b)=>a-b);

  // Flatten to {row, col, value}
  const cells = [];
  worldRows.forEach(d => {
    keys.forEach(k => cells.push({ row:k, col:d.year, value:d[k] }));
  });

  const width=900, height=280, margin={top:18,right:18,bottom:34,left:110};
  const svg = d3.select(sel).append("svg").attr("width",width).attr("height",height);

  const x = d3.scaleBand().domain(years).range([margin.left, width - margin.right]).padding(0);
  const y = d3.scaleBand().domain(keys).range([margin.top, height - margin.bottom]).padding(0.06);

  const max = d3.max(cells, d => d.value) || 1;
  const color = d3.scaleSequential(d3.interpolateOrRd).domain([0, max]);

  // cells
  svg.append("g")
     .selectAll("rect").data(cells).join("rect")
      .attr("x", d => x(d.col))
      .attr("y", d => y(d.row))
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("fill", d => color(d.value))
      .on("mousemove",(ev,d)=>{
        tip.style("opacity",1)
           .html(`<strong>${d.row}</strong> — ${d.col}<br/>${d3.format(",")(d.value)} deaths`)
           .style("left", (ev.pageX)+"px").style("top",(ev.pageY)+"px");
      })
      .on("mouseleave",()=> tip.style("opacity",0));

  // axes (thinned years to avoid clutter)
  const xticks = years.filter(y => y % 4 === 0 || y === years[0] || y === years.at(-1));
  svg.append("g").attr("class","axis")
     .attr("transform",`translate(0,${height - margin.bottom})`)
     .call(d3.axisBottom(x).tickValues(xticks).tickSize(0));

  svg.append("g").attr("class","axis")
     .attr("transform",`translate(${margin.left},0)`)
     .call(d3.axisLeft(y).tickSize(0));

  // color legend (gradient)
  const legendW = 200, legendH = 10, lx = width - margin.right - legendW, ly = margin.top - 10;
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id","hm-grad");
  grad.append("stop").attr("offset","0%").attr("stop-color", color(0));
  grad.append("stop").attr("offset","100%").attr("stop-color", color(max));

  svg.append("rect").attr("x",lx).attr("y",ly).attr("width",legendW).attr("height",legendH).attr("fill","url(#hm-grad)");
  const s = d3.scaleLinear().domain([0,max]).range([lx, lx+legendW]);
  svg.append("g").attr("class","axis")
     .attr("transform",`translate(0,${ly+legendH})`)
     .call(d3.axisBottom(s).ticks(3).tickFormat(d3.format(",")));

  d3.select(sel).append("div").attr("class","caption").text("Color scale encodes absolute global counts (UCDP).");
}
