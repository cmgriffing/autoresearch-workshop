import React from 'react';

export default function IconButton({ label, onClick }) {
  return React.createElement(
    'button',
    { type: 'button', onClick },
    label
  );
}
