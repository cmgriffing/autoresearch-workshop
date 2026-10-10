/**
 * PIM client. Works on the server (server components pass `pimUrl` down from
 * the environment) and in the browser (client components receive the URL as a
 * prop and fetch the fixture origin directly).
 */

export function apiUrl(pimUrl, path, params = {}) {
  const url = new URL(path, pimUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`PIM request failed (${response.status}): ${url}`);
  }
  return response.json();
}

export function getProduct(pimUrl, seed) {
  return fetchJson(apiUrl(pimUrl, '/api/product', { seed }));
}

export function getPromo(pimUrl, seed) {
  return fetchJson(apiUrl(pimUrl, '/api/promo', { seed }));
}

export function getReviews(pimUrl, seed) {
  return fetchJson(apiUrl(pimUrl, '/api/reviews', { seed }));
}

export function getShipping(pimUrl, seed) {
  return fetchJson(apiUrl(pimUrl, '/api/shipping', { seed }));
}

/** The PIM origin is injected by the benchmark harness at run time. */
export function pimUrlFromEnv() {
  const url = process.env.PIM_URL;
  if (!url) {
    throw new Error('PIM_URL is not set. Run the app through the benchmark harness (pnpm bench).');
  }
  return url;
}
