import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { routes as appRoutes } from '../src/routes.js';
import { routes as harnessRoutes } from '../bench/routes.js';

for (const harnessRoute of harnessRoutes) {
  test(`route ${harnessRoute.path} renders its marker "${harnessRoute.marker}"`, () => {
    const appRoute = appRoutes.find((r) => r.path === harnessRoute.path);
    assert.ok(appRoute, `application route ${harnessRoute.path} not found`);
    const html = renderToString(React.createElement(appRoute.component));
    assert.ok(
      html.includes(harnessRoute.marker),
      `expected marker "${harnessRoute.marker}" in rendered HTML for ${harnessRoute.path}`
    );
  });
}
