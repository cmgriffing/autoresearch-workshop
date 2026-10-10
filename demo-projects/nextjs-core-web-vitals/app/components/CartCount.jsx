'use client';

import { useCart } from './CartProvider.jsx';

export function CartCount() {
  const { cart } = useCart();
  return (
    <span className="cart-count" data-bench="cart-count">
      {cart.count}
    </span>
  );
}
