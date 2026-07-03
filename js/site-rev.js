const FETCH_OPTS = {
  cache: "reload",
  headers: {
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
};

const BUST_ATTEMPTS_KEY = "ecal_bust_attempts";

export async function fetchLiveSiteRev() {
  const res = await fetch(`data/site-rev.json?_=${Date.now()}`, FETCH_OPTS);
  if (!res.ok) return null;
  const data = await res.json();
  return data.rev ?? null;
}

function bustAttempts() {
  try {
    return Number(sessionStorage.getItem(BUST_ATTEMPTS_KEY) || 0);
  } catch {
    return 0;
  }
}

function clearBustAttempts() {
  try {
    sessionStorage.removeItem(BUST_ATTEMPTS_KEY);
  } catch {}
}

function incrementBustAttempts() {
  try {
    sessionStorage.setItem(BUST_ATTEMPTS_KEY, String(bustAttempts() + 1));
  } catch {}
}

export function redirectForSiteRev(liveRev) {
  if (bustAttempts() >= 3) {
    clearBustAttempts();
    return false;
  }

  incrementBustAttempts();
  location.replace(
    `${location.pathname}?v=${encodeURIComponent(liveRev)}&_=${Date.now()}`
  );
  return true;
}

export function shouldReloadForRev(liveRev, loadedRev) {
  if (!liveRev) return false;

  const urlRev = new URLSearchParams(location.search).get("v");
  if (liveRev === loadedRev && liveRev === urlRev) return false;
  return true;
}

export async function reloadIfSiteRevChanged(liveRev, loadedRev) {
  if (!shouldReloadForRev(liveRev, loadedRev)) return false;
  return redirectForSiteRev(liveRev);
}

export async function bootstrap() {
  let rev = String(Date.now());
  try {
    const liveRev = await fetchLiveSiteRev();
    if (liveRev) rev = liveRev;
  } catch {}

  const urlRev = new URLSearchParams(location.search).get("v");
  if (shouldReloadForRev(rev, urlRev) && redirectForSiteRev(rev)) return;

  clearBustAttempts();

  const css = document.getElementById("app-css");
  if (css) css.href = `css/styles.css?v=${encodeURIComponent(rev)}`;
  globalThis.__ECAL_V__ = rev;
  await import(`./app.js?v=${encodeURIComponent(rev)}`);
}
