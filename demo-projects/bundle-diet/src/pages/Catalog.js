import React from 'react';
import { catalog } from '../data/catalog.js';
import { Card } from '../components/index.js';

export default function Catalog() {
  return React.createElement(
    'div',
    null,
    React.createElement('h2', null, 'Catalog'),
    React.createElement('p', null, `Showing ${catalog.length} items`),
    React.createElement(Card, { title: catalog[0]?.name || 'Item' })
  );
}
