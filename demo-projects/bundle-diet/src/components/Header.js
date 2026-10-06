import React from 'react';
import {
  HomeIcon,
  ListIcon,
  DetailIcon,
  EditIcon,
  SettingsIcon,
  AboutIcon,
} from '../icons/index.js';

const links = [
  { path: '#/', label: 'Home', Icon: HomeIcon },
  { path: '#/catalog', label: 'Catalog', Icon: ListIcon },
  { path: '#/detail', label: 'Detail', Icon: DetailIcon },
  { path: '#/edit', label: 'Edit', Icon: EditIcon },
  { path: '#/settings', label: 'Settings', Icon: SettingsIcon },
  { path: '#/about', label: 'About', Icon: AboutIcon },
];

export default function Header() {
  return React.createElement(
    'header',
    null,
    React.createElement('h1', null, 'Bundle Diet'),
    React.createElement(
      'nav',
      null,
      links.map(({ path, label, Icon }) =>
        React.createElement(
          'a',
          { key: path, href: path, style: { marginRight: '1rem' } },
          React.createElement(Icon, null),
          label
        )
      )
    )
  );
}
