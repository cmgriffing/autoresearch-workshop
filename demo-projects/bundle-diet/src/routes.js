import Home from './pages/Home.js';
import Catalog from './pages/Catalog.js';
import Detail from './pages/Detail.js';
import Edit from './pages/Edit.js';
import Settings from './pages/Settings.js';
import About from './pages/About.js';

export const routes = [
  { path: '/', component: Home },
  { path: '/catalog', component: Catalog },
  { path: '/detail', component: Detail },
  { path: '/edit', component: Edit },
  { path: '/settings', component: Settings },
  { path: '/about', component: About },
];
