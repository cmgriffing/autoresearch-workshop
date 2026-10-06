/**
 * Straightforward reference implementation used to derive expected results.
 * It must be correct and easy to reason about; performance is irrelevant here.
 */

import { DatabaseSync } from 'node:sqlite';
import { setupSchema } from '../src/index.js';
import { generateBaseDatabase } from './data.js';

export const REFERENCE_COUNTS = {
  customers: 200,
  products: 100,
  orders: 500,
  order_items: 1_500,
  reviews: 250,
};

export function buildReferenceDatabase(path, seed = 12345) {
  generateBaseDatabase(path, seed, REFERENCE_COUNTS);
}

export function computeReference(request, db) {
  const { method, path, query = {}, body = {} } = request;

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

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  const sort = query.sort || 'id';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  const filter = query.filter || '';
  const filterField = query.filterField || 'name';
  const search = query.search || '';

  if (method === 'GET' && path === '/customers') {
    const all = db.prepare('SELECT * FROM customers').all();
    const filtered = filterRows(all, filterField, filter);
    const sorted = sortRows(filtered, sort, order);
    const rows = paginate(sorted, page, pageSize);
    return { status: 200, payload: { rows, total: filtered.length, page, pages: Math.ceil(filtered.length / pageSize) } };
  }

  if (method === 'GET' && path.startsWith('/customers/')) {
    const id = parseInt(path.split('/')[2], 10);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!customer) return { status: 404, payload: { error: 'not found' } };
    const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(id);
    return { status: 200, payload: { customer, orders } };
  }

  if (method === 'GET' && path === '/products') {
    const all = db.prepare('SELECT * FROM products').all();
    let filtered = filterRows(all, filterField, filter);
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(s) || p.description.toLowerCase().includes(s));
    }
    const sorted = sortRows(filtered, sort, order);
    const rows = paginate(sorted, page, pageSize);
    return { status: 200, payload: { rows, total: filtered.length, page, pages: Math.ceil(filtered.length / pageSize) } };
  }

  if (method === 'GET' && path.startsWith('/products/')) {
    const id = parseInt(path.split('/')[2], 10);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) return { status: 404, payload: { error: 'not found' } };
    const reviews = db.prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC').all(id);
    return { status: 200, payload: { product, reviews } };
  }

  if (method === 'GET' && path === '/orders') {
    const all = db.prepare('SELECT * FROM orders').all();
    const filtered = filterRows(all, filterField, filter);
    const sorted = sortRows(filtered, sort, order);
    const rows = paginate(sorted, page, pageSize);
    return { status: 200, payload: { rows, total: filtered.length, page, pages: Math.ceil(filtered.length / pageSize) } };
  }

  if (method === 'GET' && path.startsWith('/orders/')) {
    const id = parseInt(path.split('/')[2], 10);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) return { status: 404, payload: { error: 'not found' } };
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
    const enriched = items.map((it) => {
      const product = db.prepare('SELECT name, category FROM products WHERE id = ?').get(it.product_id);
      return { ...it, product_name: product?.name ?? null, product_category: product?.category ?? null };
    });
    return { status: 200, payload: { order, items: enriched } };
  }

  if (method === 'GET' && path === '/reviews/aggregate') {
    const rows = db.prepare('SELECT * FROM reviews').all();
    const groups = new Map();
    for (const r of rows) {
      const g = groups.get(r.product_id) || { product_id: r.product_id, count: 0, total: 0 };
      g.count += 1;
      g.total += r.rating;
      groups.set(r.product_id, g);
    }
    const result = Array.from(groups.values())
      .map((g) => ({ product_id: g.product_id, count: g.count, average_rating: g.total / g.count }))
      .sort((a, b) => b.count - a.count || a.product_id - b.product_id);
    return { status: 200, payload: { rows: result } };
  }

  if (method === 'POST' && path === '/orders') {
    const { customer_id, items } = body;
    if (!customer_id || !Array.isArray(items) || items.length === 0) {
      return { status: 400, payload: { error: 'invalid order' } };
    }
    const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id);
    if (!customer) return { status: 400, payload: { error: 'unknown customer' } };
    const now = Date.now();
    const validated = [];
    let total = 0;
    for (const it of items) {
      const product = db.prepare('SELECT price FROM products WHERE id = ?').get(it.product_id);
      if (!product) return { status: 400, payload: { error: 'unknown product' } };
      const qty = Math.max(1, Math.floor(it.quantity || 0));
      total += qty * product.price;
      validated.push({ product_id: it.product_id, quantity: qty, unit_price: product.price });
    }
    const insertOrder = db.prepare('INSERT INTO orders (customer_id, status, total, created_at) VALUES (?, ?, ?, ?)');
    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN TRANSACTION');
    const orderId = Number(insertOrder.run(customer_id, 'pending', total, now).lastInsertRowid);
    for (const it of validated) {
      insertItem.run(orderId, it.product_id, it.quantity, it.unit_price);
    }
    db.exec('COMMIT');
    return { status: 201, payload: { order_id: orderId, customer_id, total, items: validated } };
  }

  return { status: 404, payload: { error: 'not found' } };
}
