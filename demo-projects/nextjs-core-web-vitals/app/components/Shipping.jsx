'use client';

import { useEffect, useState } from 'react';
import { getShipping } from '../lib/data.js';
import { estimateShipping } from '../lib/shipping.js';
import { formatCents } from '../lib/format.js';

export function Shipping({ seed, pimUrl }) {
  const [table, setTable] = useState(null);
  const [zip, setZip] = useState('');
  const [estimateCents, setEstimateCents] = useState(null);

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

  const handleEstimate = () => {
    if (!table) return;
    setEstimateCents(estimateShipping(table, zip));
  };

  return (
    <section className="shipping">
      <h2>Delivery</h2>
      <div className="shipping-controls">
        <label htmlFor="zip">ZIP code</label>
        <input
          id="zip"
          data-bench-part="zip-input"
          inputMode="numeric"
          autoComplete="postal-code"
          value={zip}
          onChange={(event) => setZip(event.target.value.trim())}
        />
        <button type="button" className="estimate" data-bench-part="estimate" onClick={handleEstimate}>
          Estimate shipping
        </button>
      </div>
      <p className="shipping-estimate" data-bench="shipping">
        {estimateCents == null
          ? 'Enter a ZIP code for an estimate.'
          : `${formatCents(estimateCents)} shipping`}
      </p>
    </section>
  );
}
