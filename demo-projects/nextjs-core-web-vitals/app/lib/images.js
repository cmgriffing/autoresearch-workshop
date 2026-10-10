/** Builds image-CDN URLs for the bench-owned fixture origin. */

export function imageUrl(pimUrl, seed, asset, { width, fmt = 'jpeg' } = {}) {
  const url = new URL(`/cdn/${encodeURIComponent(seed)}/${encodeURIComponent(asset)}`, pimUrl);
  if (width != null) url.searchParams.set('w', String(width));
  url.searchParams.set('fmt', fmt);
  return url.toString();
}
