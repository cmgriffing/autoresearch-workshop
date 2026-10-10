import { Shopfront } from './components/Shopfront.jsx';
import { getProduct, getPromo, pimUrlFromEnv } from './lib/data.js';

export const dynamic = 'force-dynamic';

export default async function ProductPage({ searchParams }) {
  const { seed } = await searchParams;
  const pimUrl = pimUrlFromEnv();

  // Product content first, then the promo module.
  const product = await getProduct(pimUrl, seed);
  const promo = await getPromo(pimUrl, seed);

  return <Shopfront seed={seed} pimUrl={pimUrl} product={product} promo={promo} />;
}
