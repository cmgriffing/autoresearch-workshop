'use client';

import { useEffect, useState } from 'react';
import { imageUrl } from '../lib/images.js';

export function Gallery({ seed, pimUrl, product, variant }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    setSrc(imageUrl(pimUrl, seed, variant.asset, { fmt: 'jpeg' }));
  }, [pimUrl, seed, variant.asset]);

  return (
    <section className="gallery" aria-label="Product images">
      <img
        className="gallery-image"
        data-bench="hero"
        elementtiming="hero"
        src={src ?? undefined}
        alt=""
        loading="lazy"
      />
      <p className="gallery-caption">{product.name}</p>
    </section>
  );
}
