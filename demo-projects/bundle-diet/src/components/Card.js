import React from 'react';

export default function Card({ title }) {
  return React.createElement(
    'div',
    { className: 'card' },
    React.createElement('h3', null, title),
    React.createElement(
      'p',
      null,
      'A compact card component that displays a title and a short description.'
    )
  );
}
