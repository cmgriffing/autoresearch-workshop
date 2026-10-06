import React from 'react';
import { Card } from '../components/index.js';

export default function Settings() {
  return React.createElement(
    'div',
    null,
    React.createElement('h2', null, 'Settings'),
    React.createElement('p', null, 'Application preferences and defaults.'),
    React.createElement(Card, { title: 'General' })
  );
}
