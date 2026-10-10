'use client';

import { useEffect, useState } from 'react';

export function PromoBanner({ text }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="promo-banner" data-bench="banner">
      {text}
    </div>
  );
}
