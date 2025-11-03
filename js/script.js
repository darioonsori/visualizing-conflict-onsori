// ====== CONFIG ======
const DATA_PATH = "data/conflict_deaths_by_type.csv";

// Categorical palette for conflict types
const TYPE_KEYS = ["Interstate", "Intrastate", "Extrasystemic", "Non-state", "One-sided"];
const TYPE_COLORS = d3.scaleOrdinal()
  .domain(TYPE_KEYS)
  .range(["#6c8ae4", "#f28e2b", "#edc948", "#59a14f", "#e15759"]);

// ====== LOAD ======
d3.csv(DATA_PATH, d3.autoType).then(raw => {
  if (!raw?.length) { console.error("Empty CSV or not loaded"); return; }

  // Column auto-detection (OWID headers may vary a bit)
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

  // Normalize rows and compute totals
  const data = raw.map(d => ({
    entity: d[COLS.entity],
    code: d[COLS.code],
    year: +d[COLS.year],
    Interstate: +d[COLS.interstate] || 0,
    Intrastate: +d[COLS.intrastate] || 0,
    Extrasystemic: +d[COLS.extrasystemic] || 0,
    "Non-state": +d[COLS.nonstate] || 0,
    "One-sided": +d[COLS.onesided] || 0
  })).map(d => ({ ...d, total: d.Interstate + d.Intrastate + d.Extrasystemic + d["Non-state"] + d["One-sided"] }));

  const isWorld = d => (d.entity || "").toLowerCase() === "world";
  const world = data.filter(isWorld);

  // Latest year with country-level data (entity != World and total > 0)
  const latestCountryYear = d3.max(
    data.filter(d => !isWorld(d) && d.total > 0),
    d => d.year
  );

  // ----- 1) BAR: Top-10 countries in latest available year -----
  {
    const rows = data.filter(d => !isWorld(d) && d.year === latestCountryYear && d.total > 0);
    const top10 = rows.sort((a, b) => d3.descending(a.total, b.total)).slice(0, 10)
      .map(d => ({ name: d.entity, value: d.total }));

    d3.select("#bar-top10-2024").select(".card-title")
      .text(`Top 10 countries by conflict deaths in ${latestCountryYear}`);

    drawBar("#bar-top10-2024", top10, { xFormat: d3.format(","), height: 420 });
  }

  // ----- 2) GROUPED BAR: conflict types for top-5 countries (same year) -----
  {
    const rows = data.filter(d => !isWorld(d) && d.year === latestCountryYear && d.total > 0);
    const top5 = rows.sort((a, b) => d3.descending(a.total, b.total)).slice(0, 5);

    const tidy = top5.map(d => ({
      group: d.entity,
      values: TYPE_KEYS.map(k => ({ key: k, value: d[k] || 0 }))
    }));

    d3.select("#grouped-2024").select(".card-title")
      .text(`Conflict deaths by type (top 5 countries, ${latestCountryYear})`);

    drawGroupedBar("#grouped-2024", tidy, { keys: TYPE_KEYS, height: 440 });
  }

  // ----- 3) HEATMAP: World time × type -----
  {
    const matrix = [];
    world.forEach(d => {
      TYPE_KEYS.forEach(k => matrix.push({ row: k, col: d.year, value: d[k] || 0 }));
    });
    drawHeatmap("#heatmap-global", matrix, { height: 280 });
  }

  // ----- 4) 100% STACKED: share by type per year (World) -----
  {
    const rows = world.map(d => {
      const tot = d.total || 1;
      const o = { year: d.year };
      TYPE_KEYS.forEach(k => o[k] = (d[k] || 0) / tot);
      return o;
    }).sort((a, b) => a.year - b.year);

    drawStacked100("#stacked-100", rows, { keys: TYPE_KEYS, height: 320 });
  }

  // ----- 5) WAFFLE: World composition in latest available World year -----
  {
    const latestWorldYear = d3.max(world, d => d.year);
    const w = world.find(d => d.year === latestWorldYear);
    const parts = TYPE_KEYS.map(k => ({ name: k, value: w?.[k] || 0 }));

    d3.select("#waffle-2024").select(".card-title")
      .text(`Global composition of conflict deaths by type (${latestWorldYear})`);

    drawWaffle("#waffle-2024", parts, { cols: 10, rows: 10 });
  }
}).catch(err => console.error("CSV load error:", err));

/* ---------- Components (unchanged) ---------- */
function drawBar(sel, data, { width = 900, height = 380, margin = { top: 10, right: 20, bottom: 40, left: 180 }, xFormat = d3.format(",") } = {}) {
  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);
  const x = d3.scaleLinear().domain([0, d3.max(data, d => d.value) || 1]).nice().range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(data.map(d => d.name)).range([margin.top, height - margin.bottom]).padding(0.15);

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).attr("class", "axis")
    .call(d3.axisBottom(x).ticks(5).tickFormat(xFormat));
  svg.append("g").attr("transform", `translate(${margin.left},0)`).attr("class", "axis")
    .call(d3.axisLeft(y));

  svg.append("g").selectAll("rect").data(data).join("rect")
    .attr("x", x(0)).attr("y", d => y(d.name))
    .attr("width", d => x(d.value) - x(0)).attr("height", y.bandwidth())
    .attr("fill", "#8aa6ff");
}

function drawGroupedBar(sel, rows, { keys, width = 980, height = 420, margin = { top: 10, right: 20, bottom: 70, left: 48 } } = {}) {
  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);
  const groups = rows.map(d => d.group);
  const flat = rows.flatMap(d => d.values.map(v => ({ group: d.group, key: v.key, value: v.value })));
  const x0 = d3.scaleBand().domain(groups).range([margin.left, width - margin.right]).padding(0.2);
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear().domain([0, d3.max(flat, d => d.value) || 1]).nice().range([height - margin.bottom, margin.top]);

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).attr("class", "axis")
    .call(d3.axisBottom(x0)).selectAll("text").attr("transform", "rotate(-18)").style("text-anchor", "end");
  svg.append("g").attr("transform", `translate(${margin.left},0)`).attr("class", "axis")
    .call(d3.axisLeft(y).ticks(5));

  svg.append("g").selectAll("g").data(rows).join("g").attr("transform", d => `translate(${x0(d.group)},0)`)
    .selectAll("rect").data(d => d.values).join("rect")
    .attr("x", d => x1(d.key)).attr("y", d => y(d.value))
    .attr("width", x1.bandwidth()).attr("height", d => y(0) - y(d.value))
    .attr("fill", d => TYPE_COLORS(d.key));

  const legend = d3.select(sel).append("div").attr("class", "legend");
  keys.forEach(k => legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`));
}

function drawHeatmap(sel, matrix, { width = 980, height = 260, margin = { top: 20, right: 20, bottom: 30, left: 90 } } = {}) {
  const years = [...new Set(matrix.map(d => d.col))].sort((a, b) => a - b);
  const rows = [...new Set(matrix.map(d => d.row))];

  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);
  const cellW = (width - margin.left - margin.right) / years.length;
  const cellH = (height - margin.top - margin.bottom) / rows.length;

  const max = d3.max(matrix, d => d.value) || 1;
  const color = d3.scaleSequential(d3.interpolateOrRd).domain([0, max]);

  const g = svg.append("g");

  rows.forEach((r, ri) => {
    years.forEach((y, ci) => {
      const v = matrix.find(d => d.row === r && d.col === y)?.value || 0;
      g.append("rect")
        .attr("x", margin.left + ci * cellW)
        .attr("y", margin.top + ri * cellH)
        .attr("width", cellW)
        .attr("height", cellH)
        .attr("fill", color(v));
    });
  });

  const xAxis = d3.axisBottom(d3.scalePoint().domain(years.filter(y => y % 4 === 0)).range([margin.left, width - margin.right]));
  const yAxis = d3.axisLeft(d3.scalePoint().domain(rows).range([margin.top, height - margin.bottom]));

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).attr("class", "axis").call(xAxis);
  svg.append("g").attr("transform", `translate(${margin.left},0)`).attr("class", "axis").call(yAxis);
}

function drawStacked100(sel, rows, { keys, width = 980, height = 320, margin = { top: 10, right: 20, bottom: 40, left: 48 } } = {}) {
  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);
  const x = d3.scaleBand().domain(rows.map(d => d.year)).range([margin.left, width - margin.right]).padding(0.08);
  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);

  const stack = d3.stack().keys(keys)(rows);

  svg.append("g").selectAll("g").data(stack).join("g")
    .attr("fill", d => TYPE_COLORS(d.key))
    .selectAll("rect").data(d => d).join("rect")
    .attr("x", d => x(d.data.year))
    .attr("y", d => y(d[1]))
    .attr("height", d => y(d[0]) - y(d[1]))
    .attr("width", x.bandwidth());

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).attr("class", "axis")
    .call(d3.axisBottom(x).tickValues(x.domain().filter(y => y % 4 === 0)));
  svg.append("g").attr("transform", `translate(${margin.left},0)`).attr("class", "axis")
    .call(d3.axisLeft(y).tickFormat(d3.format(".0%")));

  const legend = d3.select(sel).append("div").attr("class", "legend");
  keys.forEach(k => legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`));
}

function drawWaffle(sel, parts, { cols = 10, rows = 10, size = 18, gap = 2 } = {}) {
  const total = d3.sum(parts, d => d.value) || 1;
  const units = parts.map(d => ({ name: d.name, units: Math.round(100 * (d.value / total)) }));
  let tiles = [];
  units.forEach(u => { for (let i = 0; i < u.units; i++) tiles.push({ name: u.name }); });
  tiles = tiles.slice(0, 100);

  const width = cols * (size + gap) + 20;
  const height = rows * (size + gap) + 10;
  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);

  svg.append("g").attr("transform", "translate(10,0)")
    .selectAll("rect").data(tiles).join("rect")
    .attr("x", (d, i) => (i % cols) * (size + gap))
    .attr("y", (d, i) => Math.floor(i / cols) * (size + gap))
    .attr("width", size).attr("height", size)
    .attr("fill", d => TYPE_COLORS(d.name));

  const legend = d3.select(sel).append("div").attr("class", "legend");
  parts.forEach(p => legend.append("span").html(`<i style="background:${TYPE_COLORS(p.name)}"></i>${p.name}`));
}
