/* =========================================================
   Top-10 conflict-related deaths — Countries only (year fixed)
   Data: OWID / UCDP "deaths-in-armed-conflicts-by-type"
   This script renders ONE chart and filters out regional aggregates.
   Author: Dario Onsori (course assignment)
   ========================================================= */

// ---------- CONFIG ----------
const YEAR = 2023; // choose a completed year (e.g., 2022/2023) for stable data

// Try common filenames in /data (use the first that loads successfully)
const DATA_CANDIDATES = [
  "data/conflict_deaths_by_type.csv",
  "data/deaths-in-armed-conflicts-by-type.csv",
  "data/ConflictDataByType.csv"
];

// Target container (created if missing)
const TARGET = "#bar-top10";

// ---------- BOOTSTRAP ----------
ensureContainer(TARGET, "Countries with the highest conflict-related deaths (Top 10)");

// Load the first available CSV and render
loadFirstAvailableCSV(DATA_CANDIDATES, rowAutoType)
  .then(({ rows, cols }) => {
    // Keep only real countries — ISO3 codes (3 uppercase letters), exclude OWID_*
    const isCountry = d => /^[A-Z]{3}$/.test(String(d[cols.code] || "")) && !String(d[cols.code]).startsWith("OWID");

    const yearRows = rows
      .filter(d => +d[cols.year] === YEAR && isCountry(d))
      .map(d => {
        const interstate    = +d[cols.interstate]    || 0;
        const intrastate    = +d[cols.intrastate]    || 0;
        const extrasystemic = +d[cols.extrasystemic] || 0;
        const nonstate      = +d[cols.nonstate]      || 0;
        const onesided      = +d[cols.onesided]      || 0;
        return {
          name: d[cols.entity],
          total: interstate + intrastate + extrasystemic + nonstate + onesided
        };
      })
      .filter(d => d.total > 0);

    const top10 = yearRows
      .sort((a, b) => d3.descending(a.total, b.total))
      .slice(0, 10);

    drawHorizontalBar(TARGET, top10, {
      title: `Top 10 countries by conflict-related deaths in ${YEAR}`,
      width: 900,
      height: 420,
      margin: { top: 14, right: 28, bottom: 48, left: 190 },
      xFormat: d3.format(",")
    });

    addSourceNote(
      TARGET,
      `Source: UCDP via Our World in Data — year ${YEAR}. Values are absolute counts. Regional aggregates (e.g., Europe, Africa) are excluded.`
    );
  })
  .catch(err => {
    console.error("Failed to load any data file:", err);
    d3.select(TARGET).append("p")
      .attr("class", "error")
      .text("Error: unable to load the dataset from /data. Check file name and path.");
  });

/* =========================================================
   Helpers
   ========================================================= */

/**
 * Try to load the first available CSV among a list of paths.
 * Also auto-detect OWID column names.
 */
async function loadFirstAvailableCSV(paths, rowParser) {
  let lastErr = null;
  for (const p of paths) {
    try {
      const rows = await d3.csv(p, rowParser);
      if (rows && rows.length) {
        const headers = Object.keys(rows[0] || {});
        const findCol = kw => headers.find(h => h.toLowerCase().includes(kw));

        // Column detection for OWID/UCDP file
        const cols = {
          entity: findCol("entity") || "Entity",
          code: findCol("code") || "Code",
          year: findCol("year") || "Year",
          interstate: findCol("conflict type: interstate"),
          intrastate: findCol("conflict type: intrastate"),
          extrasystemic: findCol("conflict type: extrasystemic"),
          nonstate: findCol("conflict type: non-state"),
          onesided: findCol("conflict type: one-sided")
        };

        // Minimal sanity check
        if (!cols.entity || !cols.code || !cols.year) {
          throw new Error("Missing core columns (Entity/Code/Year).");
        }
        if (!cols.intrastate || !cols.nonstate || !cols.onesided) {
          console.warn("Some conflict-type columns were not detected. Headers:", headers);
        }
        return { rows, cols, path: p };
      }
    } catch (e) {
      lastErr = e;
      // try next candidate
    }
  }
  throw lastErr || new Error("No CSV file could be loaded.");
}

/** D3 row parser: numeric auto-cast where possible */
function rowAutoType(d) {
  for (const k in d) {
    if (d[k] === "") continue;
    const v = +d[k];
    if (!Number.isNaN(v) && String(v) === String(d[k])) d[k] = v;
  }
  return d;
}

/** Ensure a container exists; if missing, create it with an optional heading */
function ensureContainer(selector, headingText = "") {
  let node = document.querySelector(selector);
  if (!node) {
    node = document.createElement("div");
    node.id = selector.replace(/^#/, "");
    document.body.appendChild(node);
  }
  if (headingText) {
    const h = document.createElement("h3");
    h.textContent = headingText;
    node.appendChild(h);
  }
}

/** Append a small source/caption paragraph after the chart */
function addSourceNote(containerSel, text) {
  const el = document.querySelector(containerSel);
  if (!el) return;
  const p = document.createElement("p");
  p.className = "source-note";
  p.textContent = text;
  el.appendChild(p);
}

/**
 * Basic horizontal bar chart (accessibility-friendly axes, value labels).
 * data: [{ name, total }]
 */
function drawHorizontalBar(
  sel,
  data,
  { title = "", width = 900, height = 380, margin = { top: 10, right: 20, bottom: 40, left: 180 }, xFormat = d3.format(",") } = {}
) {
  const container = d3.select(sel);
  container.select("svg").remove(); // clear previous render

  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("role", "img")
    .attr("aria-label", title);

  if (title) {
    svg.append("title").text(title);
  }

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.total) || 1])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map(d => d.name))
    .range([margin.top, height - margin.bottom])
    .padding(0.15);

  // Axes
  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "axis x-axis")
    .call(d3.axisBottom(x).ticks(6).tickFormat(xFormat));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .attr("class", "axis y-axis")
    .call(d3.axisLeft(y));

  // Bars
  svg.append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
      .attr("x", x(0))
      .attr("y", d => y(d.name))
      .attr("width", d => x(d.total) - x(0))
      .attr("height", y.bandwidth())
      .attr("fill", "#8EA8FF");

  // Value labels (end of bars)
  const fmt = d3.format(",");
  svg.append("g")
    .selectAll("text.value")
    .data(data)
    .join("text")
      .attr("class", "value")
      .attr("x", d => x(d.total) + 6)
      .attr("y", d => y(d.name) + y.bandwidth() / 2 + 4)
      .text(d => fmt(d.total))
      .attr("fill", "#555")
      .attr("font-size", "11px");

  // X-axis helper note (optional, for interpretation)
  container.append("p")
    .attr("class", "helper-note")
    .text("Horizontal bars compare absolute totals. Sorting by value emphasizes relative scale across countries.");
}
