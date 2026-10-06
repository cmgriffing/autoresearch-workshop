import React from 'react';
import { Card } from '../components/index.js';

export default function Detail() {
  return React.createElement(
    'div',
    null,
    React.createElement('h2', null, 'Detail'),
    React.createElement('p', null, 'Detailed view for the selected record.'),
    React.createElement(Card, { title: 'Record summary' })
  );
}
