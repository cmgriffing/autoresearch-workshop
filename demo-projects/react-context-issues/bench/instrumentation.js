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
 * host element on its ancestor chain. A fiber whose first host ancestor sits
 * outside every region (a layout wrapper) is attributed to a region only when
 * its whole subtree renders into exactly one region; components spanning
 * several regions stay unmarked and still count toward fiber totals. Host-only
 * updates (no component rendered) produce no counted fibers.
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

  /** Strict subtree walk: never visits a sibling of `root` or of its ancestors. */
  function walkSubtree(root, visit) {
    let node = root;
    while (node) {
      visit(node);
      if (node.child) {
        node = node.child;
        continue;
      }
      while (node !== root && !node.sibling) {
        node = node.return;
      }
      if (node === root) return;
      node = node.sibling;
    }
  }

  function regionOf(fiber) {
    let node = fiber;
    while (node) {
      const host = node.stateNode;
      if (host && host.nodeType === 1 && typeof host.closest === 'function') {
        const marked = host.closest('[data-bench-region]');
        if (marked) return marked.getAttribute('data-bench-region');
        break; // the first host ancestor is outside every region; check the subtree
      }
      node = node.return;
    }
    let found = null;
    walkSubtree(fiber, (candidate) => {
      if (found === '*') return;
      const host = candidate.stateNode;
      if (host && host.nodeType === 1 && typeof host.closest === 'function') {
        const marked = host.closest('[data-bench-region]');
        if (marked) {
          const name = marked.getAttribute('data-bench-region');
          if (found === null) found = name;
          else if (found !== name) found = '*';
        }
      }
    });
    return found === '*' ? null : found;
  }

  function countCommit(root) {
    const regions = {};
    let fiberRenders = 0;
    let regionRenders = 0;
    let unmarked = 0;
    walkTree(root.current, (fiber) => {
      if ((fiber.flags & 1) !== 0) {
        fiberRenders += 1;
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
