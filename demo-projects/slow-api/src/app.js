/**
 * slow-api request handler.
 *
 * Factory: createApp(db) -> (request) -> response
 *
 * Request shape:  { method, path, query?, body? }
 * Response shape: { status, payload }
 *
 * This baseline implementation is deliberately unoptimized:
 *   - schema has only primary-key indexes
 *   - related records are fetched with per-row follow-up queries
 *   - filtering, ordering and pagination are done in JavaScript
 *   - pagination uses unbounded OFFSET
 *   - prepared statements are recreated per request
 */

function parseQuery(q = {}) {
  return {
    page: Math.max(1, parseInt(q.page, 10) || 1),
    pageSize: Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 20)),
    sort: q.sort || 'id',
    order: q.order === 'desc' ? 'desc' : 'asc',
    filter: q.filter || '',
    filterField: q.filterField || 'name',
    search: q.search || '',
  };
}

function paginate(rows, page, pageSize) {
  const offset = (page - 1) * pageSize;
  return rows.slice(offset, offset + pageSize);
}

function filterRows(rows, field, value) {
  if (!value) return rows;
  const v = value.toLowerCase();
  return rows.filter((r) => String(r[field] || '').toLowerCase().includes(v));
}

function sortRows(rows, field, order) {
  const dir = order === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return dir;
    if (bv == null) return -dir;
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });
}

function badRequest(msg) {
  return { status: 400, payload: { error: msg } };
}

export function createApp(db) {
  return function handle(request) {
    const { method, path, query = {}, body = {} } = request;

    // GET /customers
    if (method === 'GET' && path === '/customers') {
      const { page, pageSize, sort, order, filter, filterField } = parseQuery(query);
      const all = db.prepare('SELECT * FROM customers').all();
      const filtered = filterRows(all, filterField, filter);
      const sorted = sortRows(filtered, sort, order);
      const rows = paginate(sorted, page, pageSize);
      const total = filtered.length;
      const pages = Math.ceil(total / pageSize);
      return { status: 200, payload: { rows, total, page, pages } };
    }

    // GET /customers/:id
    if (method === 'GET' && path.startsWith('/customers/')) {
      const id = parseInt(path.split('/')[2], 10);
      if (Number.isNaN(id)) return badRequest('invalid id');
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
      if (!customer) return { status: 404, payload: { error: 'not found' } };
      const orders = db
        .prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC')
        .all(id);
      return { status: 200, payload: { customer, orders } };
    }

    // GET /products
    if (method === 'GET' && path === '/products') {
      const { page, pageSize, sort, order, filter, filterField, search } = parseQuery(query);
      const all = db.prepare('SELECT * FROM products').all();
      let filtered = filterRows(all, filterField, filter);
      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(s) ||
            p.description.toLowerCase().includes(s)
        );
      }
      const sorted = sortRows(filtered, sort, order);
      const rows = paginate(sorted, page, pageSize);
      const total = filtered.length;
      const pages = Math.ceil(total / pageSize);
      return { status: 200, payload: { rows, total, page, pages } };
    }

    // GET /products/:id
    if (method === 'GET' && path.startsWith('/products/')) {
      const id = parseInt(path.split('/')[2], 10);
      if (Number.isNaN(id)) return badRequest('invalid id');
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!product) return { status: 404, payload: { error: 'not found' } };
      const reviews = db
        .prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC')
        .all(id);
      return { status: 200, payload: { product, reviews } };
    }

    // GET /orders
    if (method === 'GET' && path === '/orders') {
      const { page, pageSize, sort, order, filter, filterField } = parseQuery(query);
      const all = db.prepare('SELECT * FROM orders').all();
      const filtered = filterRows(all, filterField, filter);
      const sorted = sortRows(filtered, sort, order);
      const rows = paginate(sorted, page, pageSize);
      const total = filtered.length;
      const pages = Math.ceil(total / pageSize);
      return { status: 200, payload: { rows, total, page, pages } };
    }

    // GET /orders/:id
    if (method === 'GET' && path.startsWith('/orders/')) {
      const id = parseInt(path.split('/')[2], 10);
      if (Number.isNaN(id)) return badRequest('invalid id');
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!order) return { status: 404, payload: { error: 'not found' } };
      const items = db
        .prepare('SELECT * FROM order_items WHERE order_id = ?')
        .all(id);
      const enriched = items.map((it) => {
        const product = db
          .prepare('SELECT name, category FROM products WHERE id = ?')
          .get(it.product_id);
        return { ...it, product_name: product?.name ?? null, product_category: product?.category ?? null };
      });
      return { status: 200, payload: { order, items: enriched } };
    }

    // GET /reviews/aggregate
    if (method === 'GET' && path === '/reviews/aggregate') {
      const rows = db.prepare('SELECT * FROM reviews').all();
      const groups = new Map();
      for (const r of rows) {
        const key = r.product_id;
        const g = groups.get(key) || { product_id: key, count: 0, total: 0 };
        g.count += 1;
        g.total += r.rating;
        groups.set(key, g);
      }
      const result = Array.from(groups.values())
        .map((g) => ({ product_id: g.product_id, count: g.count, average_rating: g.total / g.count }))
        .sort((a, b) => b.count - a.count || a.product_id - b.product_id);
      return { status: 200, payload: { rows: result } };
    }

    // POST /orders
    if (method === 'POST' && path === '/orders') {
      const { customer_id, items } = body;
      if (!customer_id || !Array.isArray(items) || items.length === 0) {
        return badRequest('invalid order');
      }
      const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id);
      if (!customer) return badRequest('unknown customer');

      const insertOrder = db.prepare(
        'INSERT INTO orders (customer_id, status, total, created_at) VALUES (?, ?, ?, ?)'
      );
      const insertItem = db.prepare(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)'
      );
      const getProduct = db.prepare('SELECT price, stock FROM products WHERE id = ?');

      const now = Date.now();
      let total = 0;
      const validated = [];
      for (const it of items) {
        const product = getProduct.get(it.product_id);
        if (!product) return badRequest('unknown product');
        const qty = Math.max(1, Math.floor(it.quantity || 0));
        const price = product.price;
        total += qty * price;
        validated.push({ product_id: it.product_id, quantity: qty, unit_price: price });
      }

      db.exec('BEGIN TRANSACTION');
      try {
        const orderId = Number(
          insertOrder.run(customer_id, 'pending', total, now).lastInsertRowid
        );
        for (const it of validated) {
          insertItem.run(orderId, it.product_id, it.quantity, it.unit_price);
        }
        db.exec('COMMIT');
        return {
          status: 201,
          payload: { order_id: orderId, customer_id, total, items: validated },
        };
      } catch (e) {
        db.exec('ROLLBACK');
        return { status: 500, payload: { error: String(e) } };
      }
    }

    return { status: 404, payload: { error: 'not found' } };
  };
}
