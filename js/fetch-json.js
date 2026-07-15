export async function fetchJson(path) {
  const rev = globalThis.__ECAL_V__ ?? Date.now();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${sep}v=${encodeURIComponent(rev)}`);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}
