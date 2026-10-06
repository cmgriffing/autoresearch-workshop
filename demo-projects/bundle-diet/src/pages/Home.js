import React from 'react';
import { catalog } from '../data/catalog.js';
import { Card } from '../components/index.js';

export default function Home() {
  return React.createElement(
    'div',
    null,
    React.createElement('h2', null, 'Home'),
    React.createElement('p', { className: 'route-marker' }, 'home-marker'),
    React.createElement('p', null, `Loaded ${catalog.length} catalog items`),
    React.createElement(Card, { title: 'Featured item' })
  );
}
