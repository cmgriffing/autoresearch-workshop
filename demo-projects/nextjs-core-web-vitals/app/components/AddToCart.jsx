'use client';

import { useEffect, useState } from 'react';
import { useCart } from './CartProvider.jsx';
import { getShipping } from '../lib/data.js';
import { recalcShipping } from '../lib/shipping.js';

export function AddToCart({ seed, pimUrl, product, cartCount, cartLines }) {
  const { addLine } = useCart();
  const [table, setTable] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getShipping(pimUrl, seed)
      .then((shipping) => {
        if (!cancelled) setTable(shipping);
      })
      .catch(() => {
        if (!cancelled) setTable(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pimUrl, seed]);

  function handleAdd() {
    // Refresh the zone summary so the cart always shows current shipping.
    const summary = table ? recalcShipping(table) : null;
    addLine({
      id: product.name,
      name: product.name,
      shippingCents: summary ? summary.averageCents : null,
    });
  }

  return (
    <div className="purchase">
      <button type="button" className="add-to-cart" data-bench="add-to-cart" onClick={handleAdd}>
        {cartCount === 0 ? 'Add to cart' : `Add another (${cartCount} in cart)`}
      </button>
      {cartLines.length > 0 ? (
        <ul className="cart-lines">
          {cartLines.map((line, index) => (
            <li key={`${line.id}-${index}`} data-bench-part="cart-line">
              {line.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="cart-hint">Free returns within 30 days.</p>
      )}
    </div>
  );
}
