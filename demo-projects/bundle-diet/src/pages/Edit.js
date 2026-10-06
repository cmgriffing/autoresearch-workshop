import React from 'react';
import { EditorPanel } from '../components/index.js';

export default function Edit() {
  return React.createElement(
    'div',
    null,
    React.createElement('h2', null, 'Edit'),
    React.createElement('p', { className: 'route-marker' }, 'edit-marker'),
    React.createElement(EditorPanel, null)
  );
}
