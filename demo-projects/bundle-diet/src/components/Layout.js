import React from 'react';
import { Header, Footer } from './index.js';

export default function Layout({ children }) {
  return React.createElement(
    'div',
    null,
    React.createElement(Header, null),
    React.createElement('main', null, children),
    React.createElement(Footer, null)
  );
}
