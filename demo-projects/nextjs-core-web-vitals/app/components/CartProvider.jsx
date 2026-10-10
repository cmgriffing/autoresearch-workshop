'use client';

import { createContext, useCallback, useContext, useState } from 'react';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState({ lines: [], count: 0 });

  const addLine = useCallback((line) => {
    setCart((current) => ({
      lines: [...current.lines, line],
      count: current.count + 1,
    }));
  }, []);

  return <CartContext.Provider value={{ cart, addLine }}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider');
  return context;
}
