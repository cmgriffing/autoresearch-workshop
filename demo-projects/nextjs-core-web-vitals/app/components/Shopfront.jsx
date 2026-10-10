'use client';

import { useState } from 'react';
import { useCart } from './CartProvider.jsx';
import { AddToCart } from './AddToCart.jsx';
import { Gallery } from './Gallery.jsx';
import { PriceRow } from './PriceRow.jsx';
import { PromoBanner } from './PromoBanner.jsx';
import { Recommendations } from './Recommendations.jsx';
import { Reviews } from './Reviews.jsx';
import { Shipping } from './Shipping.jsx';
import { VariantPicker } from './VariantPicker.jsx';

export function Shopfront({ seed, pimUrl, product, promo }) {
  const [variantId, setVariantId] = useState(product.variants[0].id);
  const { cart } = useCart();
  const variant = product.variants.find((item) => item.id === variantId) ?? product.variants[0];

  return (
    <main className="product">
      <PromoBanner text={promo.text} />
      <Gallery key={variant.id} seed={seed} pimUrl={pimUrl} product={product} variant={variant} />
      <div className="product-summary">
        <h1 className="product-title" data-bench="title">
          {product.name}
        </h1>
        <PriceRow product={product} />
        <VariantPicker
          variants={product.variants}
          selectedId={variant.id}
          onSelect={setVariantId}
        />
        <AddToCart
          seed={seed}
          pimUrl={pimUrl}
          product={product}
          cartCount={cart.count}
          cartLines={cart.lines}
        />
      </div>
      <Shipping seed={seed} pimUrl={pimUrl} />
      <Reviews seed={seed} pimUrl={pimUrl} />
      <Recommendations seed={seed} pimUrl={pimUrl} recommendations={product.recommendations} />
    </main>
  );
}
