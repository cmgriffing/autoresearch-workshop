import React from 'react';

export default function Card({ title }) {
  return React.createElement(
    'div',
    { className: 'card' },
    React.createElement('h3', null, title),
    React.createElement(
      'p',
      null,
      'This card component is re-exported through the component barrel, so it stays on the critical path even when only one page uses it.'
    )
  );
}
