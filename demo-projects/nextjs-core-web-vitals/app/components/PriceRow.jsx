'use client';

import { useEffect, useState } from 'react';
import { formatCents } from '../lib/format.js';

export function PriceRow({ product }) {
  const [chipReady, setChipReady] = useState(false);
  const [starsReady, setStarsReady] = useState(false);

  useEffect(() => {
    const chip = setTimeout(() => setChipReady(true), 0);
    const stars = setTimeout(() => setStarsReady(true), 60);
    return () => {
      clearTimeout(chip);
      clearTimeout(stars);
    };
  }, []);

  const stars = Math.round(product.ratingAvg);

  return (
    <div className="price-row">
      <span className="price" data-bench="price">
        {formatCents(product.priceCents, product.currency)}
      </span>
      {product.discountPct > 0 && chipReady ? (
        <span className="discount" data-bench="discount">
          {product.discountPct}% off
        </span>
      ) : null}
      {product.discountPct > 0 ? (
        <span className="original-price" data-bench-part="original-price">
          {formatCents(product.listCents, product.currency)}
        </span>
      ) : null}
      {starsReady ? (
        <span className="stars" aria-label={`Rated ${product.ratingAvg} out of 5`}>
          {'★'.repeat(stars)}
          {'☆'.repeat(5 - stars)}
        </span>
      ) : null}
    </div>
  );
}
