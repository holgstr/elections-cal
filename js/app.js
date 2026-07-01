const REGION_LABELS = {
  us_primary: "US Primary",
  us_general: "US General",
  europe: "Europe",
  americas: "Americas",
  africa: "Africa",
  asia_pacific: "Asia-Pacific",
  middle_east: "Middle East",
};

const STAKES_ORDER = { high: 0, medium: 1, low: 2 };

let allElections = [];
let activeRegions = new Set();
let activeStakes = new Set();
let searchQuery = "";
let sortMode = "date-asc";

async function init() {
  const res = await fetch("data/elections.json");
  allElections = await res.json();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  allElections = allElections.filter((e) => new Date(e.date + "T12:00:00") >= today);

  buildFilters();
  renderStats();
  render();
  bindEvents();
}

function buildFilters() {
  const regions = [...new Set(allElections.map((e) => e.region))].sort();
  const stakes = ["high", "medium", "low"];

  const regionEl = document.getElementById("region-filters");
  regionEl.innerHTML = regions
    .map(
      (r) =>
        `<button type="button" class="chip" data-region="${r}">${REGION_LABELS[r] || r}</button>`
    )
    .join("");

  const stakesEl = document.getElementById("stakes-filters");
  stakesEl.innerHTML = stakes
    .map(
      (s) =>
        `<button type="button" class="chip" data-stakes="${s}">${s}</button>`
    )
    .join("");
}

function bindEvents() {
  document.getElementById("search").addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    render();
  });

  document.getElementById("sort").addEventListener("change", (e) => {
    sortMode = e.target.value;
    render();
  });

  document.getElementById("region-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-region]");
    if (!btn) return;
    const region = btn.dataset.region;
    btn.classList.toggle("active");
    if (activeRegions.has(region)) activeRegions.delete(region);
    else activeRegions.add(region);
    render();
  });

  document.getElementById("stakes-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stakes]");
    if (!btn) return;
    const stakes = btn.dataset.stakes;
    btn.classList.toggle("active");
    if (activeStakes.has(stakes)) activeStakes.delete(stakes);
    else activeStakes.add(stakes);
    render();
  });
}

function filterElections() {
  return allElections.filter((e) => {
    if (activeRegions.size && !activeRegions.has(e.region)) return false;
    if (activeStakes.size && !activeStakes.has(e.stakes)) return false;
    if (searchQuery) {
      const haystack = [
        e.country,
        e.state,
        e.title,
        e.type,
        e.notes,
        ...(e.offices || []),
        REGION_LABELS[e.region],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });
}

function sortElections(elections) {
  const sorted = [...elections];
  if (sortMode === "date-desc") {
    sorted.sort((a, b) => b.date.localeCompare(a.date));
  } else if (sortMode === "stakes-desc") {
    sorted.sort((a, b) => {
      const sd = STAKES_ORDER[a.stakes] - STAKES_ORDER[b.stakes];
      return sd !== 0 ? sd : a.date.localeCompare(b.date);
    });
  } else {
    sorted.sort((a, b) => a.date.localeCompare(b.date));
  }
  return sorted;
}

function groupByMonth(elections) {
  const groups = new Map();
  for (const e of elections) {
    const d = new Date(e.date + "T12:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key).items.push(e);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function formatCardDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return {
    day: d.getDate(),
    weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
  };
}

function renderCard(e) {
  const { day, weekday } = formatCardDate(e.date);
  const location = e.state ? `${e.state}, ${e.country}` : e.country;
  const offices = (e.offices || [])
    .map((o) => `<span class="office-tag">${o}</span>`)
    .join("");

  return `
    <article class="card">
      <div class="card-date">
        <div class="card-day">${day}</div>
        <div class="card-weekday">${weekday}</div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${e.title}</h3>
        <p class="card-location">${location}</p>
        <div class="card-offices">${offices}</div>
        <p class="card-notes">${e.notes}</p>
      </div>
      <div class="card-badges">
        <span class="badge badge-stakes-${e.stakes}">${e.stakes} stakes</span>
        <span class="badge badge-region badge-region-${e.region}">${REGION_LABELS[e.region] || e.region}</span>
      </div>
    </article>
  `;
}

function renderStats() {
  const high = allElections.filter((e) => e.stakes === "high").length;
  const us = allElections.filter((e) => e.region.startsWith("us_")).length;
  const next = allElections[0];

  document.getElementById("stats").innerHTML = `
    <div class="stat">
      <div class="stat-value">${allElections.length}</div>
      <div class="stat-label">Upcoming</div>
    </div>
    <div class="stat">
      <div class="stat-value">${high}</div>
      <div class="stat-label">High stakes</div>
    </div>
    <div class="stat">
      <div class="stat-value">${us}</div>
      <div class="stat-label">US races</div>
    </div>
    ${
      next
        ? `<div class="stat">
      <div class="stat-value" style="font-size:1rem">${next.title.replace(/Primary|Election.*/, "").trim()}</div>
      <div class="stat-label">Next: ${new Date(next.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
    </div>`
        : ""
    }
  `;
}

function render() {
  const filtered = sortElections(filterElections());
  const timeline = document.getElementById("timeline");

  if (!filtered.length) {
    timeline.innerHTML = `<p class="empty">No elections match your filters.</p>`;
    return;
  }

  const groups = groupByMonth(filtered);
  timeline.innerHTML = groups
    .map(
      ([, { label, items }]) => `
      <div class="month-group">
        <h2 class="month-heading">${label}</h2>
        <div class="cards">${items.map(renderCard).join("")}</div>
      </div>
    `
    )
    .join("");
}

init();
