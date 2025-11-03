// ====== CONFIG ======
const DATA_PATH = "data/conflict_deaths_by_type.csv";

// Palette discreta per i tipi (5 colori):
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"])
  .range(["#6c8ae4","#f28e2b","#edc948","#59a14f","#e15759"]);

// Paesi per il grouped-bar (scegline altri se vuoi)
const FOCUS_COUNTRIES = ["Ukraine","Syria","Yemen","Democratic Republic of Congo","Afghanistan"];

// ====== LOAD ======
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw?.length) { console.error("CSV vuoto o non caricato"); return; }

  // Autodetect nomi colonne OWID
  const headers = Object.keys(raw[0]);
  const findCol = kw => headers.find(h => h.toLowerCase().includes(kw));
  const COLS = {
    entity: findCol("entity") || "Entity",
    code: findCol("code") || "Code",
    year: findCol("year") || "Year",
    interstate: findCol("conflict type: interstate"),
    intrastate: findCol("conflict type: intrastate"),
    extrasystemic: findCol("conflict type: extrasystemic"),
    nonstate: findCol("conflict type: non-state"),
    onesided: findCol("conflict type: one-sided")
  };
  // Sanity check
  if (!COLS.interstate || !COLS.intrastate || !COLS.nonstate || !COLS.onesided){
    console.warn("Non sono state rilevate tutte le colonne tipo conflitto. Headers:", headers);
  }

  // Arricchisci righe con totale
  const data = raw.map(d => ({
    entity: d[COLS.entity],
    code: d[COLS.code],
    year: +d[COLS.year],
    Interstate: +d[COLS.interstate] || 0,
    Intrastate: +d[COLS.intrastate] || 0,
    Extrasystemic: +d[COLS.extrasystemic] || 0,
    "Non-state": +d[COLS.nonstate] || 0,
    "One-sided": +d[COLS.onesided] || 0
  })).map(d => ({...d, total: d.Interstate+d.Intrastate+d.Extrasystemic+d["Non-state"]+d["One-sided"]}));

  const world = data.filter(d => d.entity === "World");
  const byYear = y => data.filter(d => d.year === y);

  // ---------- 1) BARCHART: Top10 paesi 2024 ----------
  {
    const YEAR = 2024;
    const rows = byYear(YEAR).filter(d => d.entity !== "World" && d.total > 0);
    const top10 = rows.sort((a,b)=>d3.descending(a.total,b.total)).slice(0,10)
                      .map(d => ({name: d.entity, value: d.total}));
    drawBar("#bar-top10-2024", top10, {xFormat: d3.format(","), height: 420});
  }

  // ---------- 2) GROUPED BAR: tipi su paesi selezionati 2024 ----------
  {
    const YEAR = 2024, KEYS = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
    const rows = byYear(YEAR).filter(d => FOCUS_COUNTRIES.includes(d.entity));
    const tidy = rows.map(d => ({
      group: d.entity,
      values: KEYS.map(k => ({key: k, value: d[k]}))
    }));
    drawGroupedBar("#grouped-2024", tidy, {keys: KEYS, height: 440});
  }

  // ---------- 3) HEATMAP: anni × tipo (World) ----------
  {
    const KEYS = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
    const matrix = [];
    world.forEach(d => {
      KEYS.forEach(k => matrix.push({row: k, col: d.year, value: d[k]}));
    });
    drawHeatmap("#heatmap-global", matrix, {height: 280});
  }

  // ---------- 4) 100% STACKED: quota per tipo per anno (World) ----------
  {
    const KEYS = ["Interstate","Intrastate","Extrasystemic","Non-state","One-sided"];
    const rows = world.map(d => {
      const total = d.total || 1;
      const o = {year: d.year};
      KEYS.forEach(k => o[k] = (d[k]||0)/total);
      return o;
    }).sort((a,b)=>a.year-b.year);
    drawStacked100("#stacked-100", rows, {keys: KEYS, height: 320});
  }

  // ---------- 5) WAFFLE: composizione World 2024 ----------
  {
    const YEAR = 2024;
    const w = world.find(d => d.year === YEAR) || world[world.length-1];
    const parts = [
      {name:"Interstate", value:w?.Interstate||0},
      {name:"Intrastate", value:w?.Intrastate||0},
      {name:"Extrasystemic", value:w?.Extrasystemic||0},
      {name:"Non-state", value:w?.["Non-state"]||0},
      {name:"One-sided", value:w?.["One-sided"]||0},
    ];
    drawWaffle("#waffle-2024", parts, {cols:10, rows:10});
  }
})
.catch(err => console.error("Errore nel caricamento CSV:", err));

/* ----------------------------------------------------
    COMPONENTS
---------------------------------------------------- */

// Simple horizontal bar
function drawBar(sel, data, {width=900, height=380, margin={top:10,right:20,bottom:40,left:180}, xFormat=d3.format(",")}={}){
  const svg = d3.select(sel).append("svg").attr("width",width).attr("height",height);
  const x = d3.scaleLinear().domain([0, d3.max(data,d=>d.value)||1]).nice().range([margin.left, width-margin.right]);
  const y = d3.scaleBand().domain(data.map(d=>d.name)).range([margin.top, height-margin.bottom]).padding(0.15);

  svg.append("g").attr("transform",`translate(0,${height-margin.bottom})`).attr("class","axis")
     .call(d3.axisBottom(x).ticks(5).tickFormat(xFormat));
  svg.append("g").attr("transform",`translate(${margin.left},0)`).attr("class","axis")
     .call(d3.axisLeft(y));

  svg.append("g").selectAll("rect").data(data).join("rect")
     .attr("x", x(0)).attr("y", d=>y(d.name))
     .attr("width", d=>x(d.value)-x(0)).attr("height", y.bandwidth())
     .attr("fill", "#8aa6ff");
}

// Grouped bar (categorie per gruppo)
function drawGroupedBar(sel, rows, {keys, width=980, height=420, margin={top:10,right:20,bottom:70,left:48}}={}){
  const svg = d3.select(sel).append("svg").attr("width",width).attr("height",height);
  const groups = rows.map(d=>d.group);
  const flat = rows.flatMap(d => d.values.map(v => ({group:d.group, key:v.key, value:v.value})));
  const x0 = d3.scaleBand().domain(groups).range([margin.left, width-margin.right]).padding(0.2);
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear().domain([0, d3.max(flat,d=>d.value)||1]).nice().range([height-margin.bottom, margin.top]);

  svg.append("g").attr("transform",`translate(0,${height-margin.bottom})`).attr("class","axis")
     .call(d3.axisBottom(x0)).selectAll("text").attr("transform","rotate(-18)").style("text-anchor","end");
  svg.append("g").attr("transform",`translate(${margin.left},0)`).attr("class","axis")
     .call(d3.axisLeft(y).ticks(5));

  svg.append("g").selectAll("g").data(rows).join("g").attr("transform", d=>`translate(${x0(d.group)},0)`)
     .selectAll("rect").data(d=>d.values).join("rect")
     .attr("x", d=>x1(d.key)).attr("y", d=>y(d.value))
     .attr("width", x1.bandwidth()).attr("height", d=>y(0)-y(d.value))
     .attr("fill", d=>TYPE_COLORS(d.key));

  // leggenda
  const legend = d3.select(sel).append("div").attr("class","legend");
  keys.forEach(k => legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`));
}

// Heatmap anno × tipo
function drawHeatmap(sel, matrix, {width=980, height=260, margin={top:20,right:20,bottom:30,left:90}}={}){
  const years = [...new Set(matrix.map(d=>d.col))].sort((a,b)=>a-b);
  const rows = [...new Set(matrix.map(d=>d.row))];

  const svg = d3.select(sel).append("svg").attr("width",width).attr("height",height);
  const cellW = (width - margin.left - margin.right) / years.length;
  const cellH = (height - margin.top - margin.bottom) / rows.length;

  const max = d3.max(matrix, d=>d.value)||1;
  const color = d3.scaleSequential(d3.interpolateOrRd).domain([0, max]);

  const g = svg.append("g");

  rows.forEach((r, ri) => {
    years.forEach((y, ci) => {
      const v = matrix.find(d => d.row===r && d.col===y)?.value || 0;
      g.append("rect")
        .attr("x", margin.left + ci*cellW)
        .attr("y", margin.top + ri*cellH)
        .attr("width", cellW)
        .attr("height", cellH)
        .attr("fill", color(v));
    });
  });

  const xAxis = d3.axisBottom(d3.scalePoint().domain(years.filter(y=>y%4===0)).range([margin.left, width-margin.right]));
  const yAxis = d3.axisLeft(d3.scalePoint().domain(rows).range([margin.top, height-margin.bottom]));

  svg.append("g").attr("transform",`translate(0,${height-margin.bottom})`).attr("class","axis").call(xAxis);
  svg.append("g").attr("transform",`translate(${margin.left},0)`).attr("class","axis").call(yAxis);
}

// 100% stacked by year
function drawStacked100(sel, rows, {keys, width=980, height=320, margin={top:10,right:20,bottom:40,left:48}}={}){
  const svg = d3.select(sel).append("svg").attr("width",width).attr("height",height);
  const x = d3.scaleBand().domain(rows.map(d=>d.year)).range([margin.left, width-margin.right]).padding(0.08);
  const y = d3.scaleLinear().domain([0,1]).range([height-margin.bottom, margin.top]);

  const stack = d3.stack().keys(keys)(rows);

  svg.append("g").selectAll("g").data(stack).join("g")
    .attr("fill", d => TYPE_COLORS(d.key))
    .selectAll("rect").data(d => d).join("rect")
      .attr("x", d => x(d.data.year))
      .attr("y", d => y(d[1]))
      .attr("height", d => y(d[0]) - y(d[1]))
      .attr("width", x.bandwidth());

  svg.append("g").attr("transform",`translate(0,${height-margin.bottom})`).attr("class","axis")
     .call(d3.axisBottom(x).tickValues(x.domain().filter(y=>y%4===0)));
  svg.append("g").attr("transform",`translate(${margin.left},0)`).attr("class","axis")
     .call(d3.axisLeft(y).tickFormat(d3.format(".0%")));

  const legend = d3.select(sel).append("div").attr("class","legend");
  keys.forEach(k => legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`));
}

// Waffle (n×m = 100 tasselli)
function drawWaffle(sel, parts, {cols=10, rows=10, size=18, gap=2}={}){
  const total = d3.sum(parts, d=>d.value)||1;
  const units = parts.map(d => ({name:d.name, units: Math.round(100*(d.value/total))}));
  // Normalizza a 100 tasselli precisi
  let tiles = [];
  units.forEach(u => { for(let i=0;i<u.units;i++) tiles.push({name:u.name}); });
  tiles = tiles.slice(0, 100);

  const width = cols*(size+gap)+20;
  const height = rows*(size+gap)+10;
  const svg = d3.select(sel).append("svg").attr("width",width).attr("height",height);

  svg.append("g").attr("transform","translate(10,0)")
    .selectAll("rect").data(tiles).join("rect")
      .attr("x", (d,i) => (i%cols)*(size+gap))
      .attr("y", (d,i) => Math.floor(i/cols)*(size+gap))
      .attr("width", size).attr("height", size)
      .attr("fill", d => TYPE_COLORS(d.name));

  // legenda
  const legend = d3.select(sel).append("div").attr("class","legend");
  parts.forEach(p => legend.append("span").html(`<i style="background:${TYPE_COLORS(p.name)}"></i>${p.name}`));
}
