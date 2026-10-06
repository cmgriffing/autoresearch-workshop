import React from 'react';
import { Card } from '../components/index.js';

export default function About() {
  return React.createElement(
    'div',
    null,
    React.createElement('h2', null, 'About'),
    React.createElement('p', null, 'Bundle Diet demo application.'),
    React.createElement(Card, { title: 'Credits' })
  );
}
