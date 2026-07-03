const FETCH_OPTS = {
  cache: "reload",
  headers: {
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
};

export async function fetchJson(path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${sep}_=${Date.now()}`, FETCH_OPTS);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}
