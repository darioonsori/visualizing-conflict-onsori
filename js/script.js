/* =========================================================
   Data Visualization — Comparing Categories (D3 v7)
   Source: OWID / UCDP — deaths-in-armed-conflicts-by-type
   Author: Dario Onsori
   Notes:
   - Snapshot comparisons use year = 2023 (last complete year).
   - Regional aggregates are excluded from country top-lists.
   - Color palette is consistent across all charts.
   ========================================================= */

/* ---------------------------
   GLOBAL CONFIGURATION
---------------------------- */
const DATA_PATH = "data/conflict_deaths_by_type.csv";

// Canonical order and color mapping for conflict types
const TYPE_ORDER = ["Interstate", "Intrastate", "Extrasystemic", "Non-state", "One-sided"];
const TYPE_COLORS = d3
  .scaleOrdinal()
  .domain(TYPE_ORDER)
  .range(["#6c8ae4", "#f28e2b", "#edc948", "#59a14f", "#e15759"]);

// Countries shown in the grouped bar (edit freely)
const FOCUS_COUNTRIES = ["Ukraine", "Syria", "Yemen", "Democratic Republic of Congo", "Afghanistan"];

// Region-level aggregates to exclude from country comparisons
const EXCLUDE_ENTITIES = new Set([
  "World", "Europe", "Africa", "Middle East", "Asia", "Asia and Oceania", "Oceania",
  "Americas", "European Union", "European Union (27)", "European Union (28)"
]);

// Reference year for snapshot charts (last complete year)
const SNAPSHOT_YEAR = 2023;

// Number formatters
const FMT_INT = d3.format(",");        // e.g., 12,345
const FMT_PCT0 = d3.format(".0%");     // e.g., 37%


/* ---------------------------
   DATA LOADING & PREP
---------------------------- */
d3.csv(DATA_PATH, d3.autoType)
  .then(raw => {
    if (!raw || !raw.length) {
      console.error("CSV is empty or not loaded.");
      return;
    }

    // Robust column detection (handles minor name variations)
    const headers = Object.keys(raw[0]);
    const findCol = (candidates) => {
      const lower = headers.map(h => [h, h.toLowerCase()]);
      for (const c of candidates) {
        const i = lower.findIndex(([_, hl]) => hl.includes(c));
        if (i !== -1) return lower[i][0];
      }
      return null;
    };

    const COLS = {
      entity:        findCol(["entity", "country"]),
      code:          findCol(["code", "iso"]),
      year:          findCol(["year"]),
      interstate:    findCol(["conflict type: interstate", "interstate"]),
      intrastate:    findCol(["conflict type: intrastate", "intrastate"]),
      extrasystemic: findCol(["conflict type: extrasystemic", "extrasystemic"]),
      nonstate:      findCol(["conflict type: non-state", "non-state", "nonstate"]),
      onesided:      findCol(["conflict type: one-sided", "one-sided", "onesided"])
    };

    // Warn if required columns are missing
    const required = ["entity", "year", "interstate", "intrastate", "nonstate", "onesided"];
    const missing = required.filter(k => !COLS[k]);
    if (missing.length) {
      console.warn("Missing expected columns:", missing, "\nHeaders:", headers);
    }

    // Normalize and compute totals on each row
    const data = raw.map(d => {
      const row = {
        entity:        d[COLS.entity],
        code:          COLS.code ? d[COLS.code] : undefined,
        year:          +d[COLS.year],
        Interstate:    +d[COLS.interstate]    || 0,
        Intrastate:    +d[COLS.intrastate]    || 0,
        Extrasystemic: +d[COLS.extrasystemic] || 0,
        "Non-state":   +d[COLS.nonstate]      || 0,
        "One-sided":   +d[COLS.onesided]      || 0
      };
      row.total = TYPE_ORDER.reduce((acc, k) => acc + (row[k] || 0), 0);
      return row;
    });

    // Convenience accessors
    const worldRows = data.filter(d => d.entity === "World").sort((a, b) => a.year - b.year);
    const rowsByYear = (y) => data.filter(d => d.year === y);

    /* --------------------------------------------
       1) BAR CHART — Top 10 countries (snapshot)
       -------------------------------------------- */
    {
      const YEAR = SNAPSHOT_YEAR;
      const rows = rowsByYear(YEAR)
        .filter(d => !EXCLUDE_ENTITIES.has(d.entity) && d.total > 0);

      const top10 = rows
        .sort((a, b) => d3.descending(a.total, b.total))
        .slice(0, 10)
        .map(d => ({ name: d.entity, value: d.total }));

      drawBar("#bar-top10-2023", top10, {
        xFormat: FMT_INT,
        height: 420
      });
    }

    /* ----------------------------------------------------------
       2) GROUPED BAR — Conflict-type breakdown for 5 countries
       ---------------------------------------------------------- */
    {
      const YEAR = SNAPSHOT_YEAR;
      const keys = TYPE_ORDER;
      const rows = rowsByYear(YEAR).filter(d => FOCUS_COUNTRIES.includes(d.entity));

      const tidy = rows.map(d => ({
        group: d.entity,
        values: keys.map(k => ({ key: k, value: d[k] }))
      }));

      drawGroupedBar("#grouped-2023", tidy, {
        keys,
        height: 440
      });
    }

    /* ------------------------------------------------------
       3) HEATMAP — World deaths by Year × Conflict Type
       ------------------------------------------------------ */
    {
      const keys = TYPE_ORDER;
      const matrix = [];
      worldRows.forEach(d => {
        keys.forEach(k => matrix.push({ row: k, col: d.year, value: d[k] }));
      });

      drawHeatmap("#heatmap-global", matrix, {
        height: 280
      });
    }

    /* ----------------------------------------------------------------
       4) 100% STACKED — World share by conflict type (time series)
       ---------------------------------------------------------------- */
    {
      const keys = TYPE_ORDER;
      const series = worldRows
        .map(d => {
          const total = d.total || 1;
          const o = { year: d.year };
          keys.forEach(k => (o[k] = (d[k] || 0) / total));
          return o;
        })
        .sort((a, b) => a.year - b.year);

      drawStacked100("#stacked-100", series, {
        keys,
        height: 320,
        yFormat: FMT_PCT0
      });
    }

    /* ----------------------------------------------------------
       5) WAFFLE — World composition by conflict type (snapshot)
       ---------------------------------------------------------- */
    {
      const YEAR = SNAPSHOT_YEAR;
      const w = worldRows.find(d => d.year === YEAR) || worldRows[worldRows.length - 1];

      const parts = TYPE_ORDER.map(name => ({ name, value: w?.[name] || 0 }));

      drawWaffle("#waffle-2023", parts, {
        cols: 10,
        rows: 10
      });
    }
  })
  .catch(err => console.error("Error loading CSV:", err));


/* =========================================================
   CHART COMPONENTS
   (All components are self-contained and reusable)
   ========================================================= */

/**
 * Horizontal bar chart.
 * @param {string} sel - CSS selector for the container.
 * @param {Array<{name: string, value: number}>} data
 * @param {object} opts - width, height, margin, xFormat
 */
function drawBar(sel, data, {
  width = 900,
  height = 380,
  margin = { top: 10, right: 20, bottom: 40, left: 180 },
  xFormat = FMT_INT
} = {}) {
  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.value) || 1])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map(d => d.name))
    .range([margin.top, height - margin.bottom])
    .padding(0.15);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x).ticks(5).tickFormat(xFormat));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y));

  svg.append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", x(0))
    .attr("y", d => y(d.name))
    .attr("width", d => x(d.value) - x(0))
    .attr("height", y.bandwidth())
    .attr("fill", "#8aa6ff");
}

/**
 * Grouped bar chart (multiple categories per group).
 * @param {string} sel
 * @param {Array<{group: string, values: Array<{key: string, value: number}>}>} rows
 * @param {object} opts - keys, width, height, margin
 */
function drawGroupedBar(sel, rows, {
  keys,
  width = 980,
  height = 420,
  margin = { top: 10, right: 20, bottom: 70, left: 48 }
} = {}) {
  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);

  const groups = rows.map(d => d.group);
  const flat = rows.flatMap(d => d.values.map(v => ({ group: d.group, key: v.key, value: v.value })));

  const x0 = d3.scaleBand().domain(groups).range([margin.left, width - margin.right]).padding(0.2);
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear()
    .domain([0, d3.max(flat, d => d.value) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x0))
    .selectAll("text")
    .attr("transform", "rotate(-18)")
    .style("text-anchor", "end");

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(5));

  svg.append("g")
    .selectAll("g")
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
    .attr("fill", d => TYPE_COLORS(d.key));

  // Legend
  addLegend(sel, keys);
}

/**
 * Heatmap (Year × Type).
 * @param {string} sel
 * @param {Array<{row: string, col: number, value: number}>} matrix
 * @param {object} opts - width, height, margin
 */
function drawHeatmap(sel, matrix, {
  width = 980,
  height = 260,
  margin = { top: 20, right: 20, bottom: 30, left: 90 }
} = {}) {
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

  const xAxis = d3.axisBottom(
    d3.scalePoint().domain(years.filter(y => y % 4 === 0)).range([margin.left, width - margin.right])
  );
  const yAxis = d3.axisLeft(
    d3.scalePoint().domain(rows).range([margin.top, height - margin.bottom])
  );

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).attr("class", "axis").call(xAxis);
  svg.append("g").attr("transform", `translate(${margin.left},0)`).attr("class", "axis").call(yAxis);
}

/**
 * 100% stacked bars over time (share per type).
 * @param {string} sel
 * @param {Array<object>} rows - objects with {year, ...keys}
 * @param {object} opts - keys, width, height, margin, yFormat
 */
function drawStacked100(sel, rows, {
  keys,
  width = 980,
  height = 320,
  margin = { top: 10, right: 20, bottom: 40, left: 48 },
  yFormat = FMT_PCT0
} = {}) {
  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);

  const x = d3.scaleBand()
    .domain(rows.map(d => d.year))
    .range([margin.left, width - margin.right])
    .padding(0.08);

  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);

  const stack = d3.stack().keys(keys)(rows);

  svg.append("g")
    .selectAll("g")
    .data(stack)
    .join("g")
    .attr("fill", d => TYPE_COLORS(d.key))
    .selectAll("rect")
    .data(d => d)
    .join("rect")
    .attr("x", d => x(d.data.year))
    .attr("y", d => y(d[1]))
    .attr("height", d => y(d[0]) - y(d[1]))
    .attr("width", x.bandwidth());

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis")
    .call(d3.axisBottom(x).tickValues(x.domain().filter(y => y % 4 === 0)));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis")
    .call(d3.axisLeft(y).tickFormat(yFormat));

  // Legend
  addLegend(sel, keys);
}

/**
 * Waffle chart (n × m = 100 tiles).
 * @param {string} sel
 * @param {Array<{name: string, value: number}>} parts
 * @param {object} opts - cols, rows, size, gap
 */
function drawWaffle(sel, parts, {
  cols = 10,
  rows = 10,
  size = 18,
  gap = 2
} = {}) {
  const total = d3.sum(parts, d => d.value) || 1;

  // Allocate 100 tiles proportionally (rounded)
  const units = parts.map(d => ({ name: d.name, units: Math.round(100 * (d.value / total)) }));

  // Normalize to exactly 100 tiles
  let tiles = [];
  units.forEach(u => { for (let i = 0; i < u.units; i++) tiles.push({ name: u.name }); });
  tiles = tiles.slice(0, 100);

  const width = cols * (size + gap) + 20;
  const height = rows * (size + gap) + 10;

  const svg = d3.select(sel).append("svg").attr("width", width).attr("height", height);

  svg.append("g")
    .attr("transform", "translate(10,0)")
    .selectAll("rect")
    .data(tiles)
    .join("rect")
    .attr("x", (_, i) => (i % cols) * (size + gap))
    .attr("y", (_, i) => Math.floor(i / cols) * (size + gap))
    .attr("width", size)
    .attr("height", size)
    .attr("fill", d => TYPE_COLORS(d.name));

  // Legend
  addLegend(sel, parts.map(p => p.name));
}

/* ---------------------------
   Helper — Legend (inline)
---------------------------- */
function addLegend(containerSel, keys) {
  const legend = d3.select(containerSel).append("div").attr("class", "legend");
  keys.forEach(k => {
    legend.append("span").html(`<i style="background:${TYPE_COLORS(k)}"></i>${k}`);
  });
}
