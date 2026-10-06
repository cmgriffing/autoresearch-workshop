import React, { useEffect, useState } from 'react';
import { routes } from './routes.js';
import { Layout } from './components/index.js';

function resolveRoute(raw) {
  const path = raw || '/';
  return routes.find((r) => r.path === path) || routes[0];
}

export default function App() {
  const [route, setRoute] = useState(() =>
    resolveRoute(window.location.hash.slice(1))
  );

  useEffect(() => {
    const listener = () => {
      setRoute(resolveRoute(window.location.hash.slice(1)));
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);

  return React.createElement(
    Layout,
    null,
    React.createElement(route.component, { key: route.path })
  );
}
