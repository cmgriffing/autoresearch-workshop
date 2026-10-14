/**
 * External React commit instrumentation.
 *
 * Installed via `addInitScript` before any application script evaluates, so
 * it is active before React DOM loads. React calls `onCommitFiberRoot` on
 * every commit in production builds; the hook walks the committed fiber tree
 * and counts fibers whose `flags` carry `PerformedWork` (bit 0) — i.e.
 * components that rendered in that commit.
 *
 * Attribution: a counted fiber is attributed to the nearest `[data-bench-region]`
 * host element on its ancestor chain. Fibers that render no host element inside
 * a region (the shell root and layout wrappers around region roots) are
 * unmarked: they still count toward fiber totals but to no region. This keeps
 * the must-render oracle strict — a region only counts when a component inside
 * it actually rendered, not when an outer wrapper re-rendered.
 *
 * The application cannot disable the accounting: the hook is installed by the
 * browser context, outside the page's module graph, and React injects into it
 * at module scope.
 */

/** Serialized into the page by `createInstrumentedContext`. */
export function instrumentationScript() {
  const state = {
    commits: [],
    errors: [],
    injected: false,
  };

  /** Full-tree walk (root and all later siblings of root's ancestors are visited). */
  function walkTree(root, visit) {
    let node = root;
    while (node) {
      visit(node);
      if (node.child) {
        node = node.child;
        continue;
      }
      while (!node.sibling) {
        if (!node.return) return;
        node = node.return;
      }
      node = node.sibling;
    }
  }

  function regionOf(fiber) {
    let node = fiber;
    while (node) {
      const host = node.stateNode;
      if (host && host.nodeType === 1 && typeof host.closest === 'function') {
        const marked = host.closest('[data-bench-region]');
        return marked ? marked.getAttribute('data-bench-region') : null;
      }
      node = node.return;
    }
    return null;
  }

  function countCommit(root) {
    const regions = {};
    let fiberRenders = 0;
    let regionRenders = 0;
    let unmarked = 0;
    const rendered = [];
    walkTree(root.current, (fiber) => {
      if ((fiber.flags & 1) !== 0) {
        fiberRenders += 1;
        rendered.push(fiber);
        const region = regionOf(fiber);
        if (region) {
          if (!Object.prototype.hasOwnProperty.call(regions, region)) {
            regions[region] = 0;
            regionRenders += 1;
          }
          regions[region] += 1;
        } else {
          unmarked += 1;
        }
      }
    });
    // React leaves `PerformedWork` set on committed fibers, so an untouched
    // fiber would be counted again on the next commit. Clear the bit after
    // counting: it is DevTools-only metadata and every later commit re-sets it
    // for the fibers that actually render.
    for (const fiber of rendered) {
      fiber.flags &= ~1;
    }
    state.commits.push({
      index: state.commits.length,
      fiberRenders,
      regionRenders,
      unmarked,
      regions,
    });
  }

  const hook = {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) {
      const id = hook.renderers.size + 1;
      hook.renderers.set(id, renderer);
      state.injected = true;
      return id;
    },
    onCommitFiberRoot(rendererId, root) {
      try {
        countCommit(root);
      } catch (error) {
        state.errors.push(String(error && error.stack ? error.stack : error));
      }
    },
    onCommitFiberUnmount() {},
  };

  Object.defineProperty(window, '__benchRender', {
    value: state,
    configurable: true,
  });
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
    value: hook,
    configurable: true,
  });
}

/**
 * Source string installed with `context.addInitScript({ content })`.
 * Also usable as the body of a Playwright init script.
 */
export const INSTRUMENTATION_SOURCE = `(${instrumentationScript.toString()})();`;
