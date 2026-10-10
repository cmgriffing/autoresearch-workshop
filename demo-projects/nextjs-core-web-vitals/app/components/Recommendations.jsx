'use client';

import { formatCents } from '../lib/format.js';
import { imageUrl } from '../lib/images.js';

export function Recommendations({ seed, pimUrl, recommendations }) {
  return (
    <section className="recommendations">
      <h2>You may also like</h2>
      <ul className="recommendation-list">
        {recommendations.map((item) => (
          <li key={item.id} className="recommendation">
            <img
              className="recommendation-image"
              src={imageUrl(pimUrl, seed, item.asset, { width: 320, fmt: 'jpeg' })}
              width={320}
              height={200}
              alt=""
              loading="lazy"
            />
            <h3>{item.name}</h3>
            <p>{formatCents(item.priceCents)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
