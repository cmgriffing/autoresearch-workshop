import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp, setupSchema } from '../src/index.js';
import { generateBaseDatabase, COUNTS } from '../bench/data.js';

const TEST_DB = join(process.cwd(), '.cache', 'test.db');

describe('slow-api correctness', () => {
  let db;
  let handle;

  before(() => {
    if (existsSync(TEST_DB)) rmSync(TEST_DB);
    mkdirSync(join(process.cwd(), '.cache'), { recursive: true });
    generateBaseDatabase(TEST_DB, 7777, {
      customers: 500,
      products: 200,
      orders: 1_000,
      order_items: 3_000,
      reviews: 500,
    });
    db = new DatabaseSync(TEST_DB);
    setupSchema(db);
    handle = createApp(db);
  });

  it('lists customers with default pagination', () => {
    const res = handle({ method: 'GET', path: '/customers' });
    assert.equal(res.status, 200);
    assert.equal(res.payload.rows.length, 20);
    assert.equal(res.payload.page, 1);
    assert.ok(res.payload.total >= 500);
  });

  it('filters customers by name', () => {
    const res = handle({ method: 'GET', path: '/customers', query: { filter: 'Customer 1', filterField: 'name' } });
    assert.equal(res.status, 200);
    assert.ok(res.payload.rows.length > 0);
    assert.ok(res.payload.rows.every((r) => r.name.includes('Customer 1')));
  });

  it('sorts customers descending', () => {
    const res = handle({ method: 'GET', path: '/customers', query: { sort: 'id', order: 'desc', pageSize: '5' } });
    assert.equal(res.status, 200);
    assert.equal(res.payload.rows.length, 5);
    for (let i = 1; i < res.payload.rows.length; i++) {
      assert.ok(res.payload.rows[i - 1].id > res.payload.rows[i].id);
    }
  });

  it('returns empty deep page', () => {
    const res = handle({ method: 'GET', path: '/customers', query: { page: '1000', pageSize: '20' } });
    assert.equal(res.status, 200);
    assert.equal(res.payload.rows.length, 0);
    assert.equal(res.payload.total, 500);
  });

  it('returns customer detail with orders', () => {
    const res = handle({ method: 'GET', path: '/customers/10' });
    assert.equal(res.status, 200);
    assert.equal(res.payload.customer.id, 10);
    assert.ok(Array.isArray(res.payload.orders));
  });

  it('returns 404 for missing customer', () => {
    const res = handle({ method: 'GET', path: '/customers/999999' });
    assert.equal(res.status, 404);
  });

  it('searches products by text', () => {
    const res = handle({ method: 'GET', path: '/products', query: { search: 'electronics', pageSize: '50' } });
    assert.equal(res.status, 200);
    assert.ok(res.payload.rows.length > 0);
    assert.ok(res.payload.rows.every((p) => p.category === 'electronics' || p.description.includes('electronics')));
  });

  it('returns product detail with reviews', () => {
    const res = handle({ method: 'GET', path: '/products/5' });
    assert.equal(res.status, 200);
    assert.equal(res.payload.product.id, 5);
    assert.ok(Array.isArray(res.payload.reviews));
  });

  it('lists orders', () => {
    const res = handle({ method: 'GET', path: '/orders', query: { pageSize: '10' } });
    assert.equal(res.status, 200);
    assert.equal(res.payload.rows.length, 10);
    assert.ok(res.payload.total >= 1000);
  });

  it('filters orders by status', () => {
    const res = handle({ method: 'GET', path: '/orders', query: { filter: 'pending', filterField: 'status' } });
    assert.equal(res.status, 200);
    assert.ok(res.payload.rows.every((r) => r.status === 'pending'));
  });

  it('returns order detail with enriched items', () => {
    const res = handle({ method: 'GET', path: '/orders/50' });
    assert.equal(res.status, 200);
    assert.equal(res.payload.order.id, 50);
    assert.ok(Array.isArray(res.payload.items));
    if (res.payload.items.length > 0) {
      assert.ok('product_name' in res.payload.items[0]);
    }
  });

  it('aggregates reviews', () => {
    const res = handle({ method: 'GET', path: '/reviews/aggregate' });
    assert.equal(res.status, 200);
    assert.ok(res.payload.rows.length > 0);
    assert.ok('average_rating' in res.payload.rows[0]);
    assert.ok('count' in res.payload.rows[0]);
  });

  it('creates an order and returns it', () => {
    const before = handle({ method: 'GET', path: '/orders', query: { pageSize: '1', sort: 'id', order: 'desc' } });
    const maxId = before.payload.rows[0]?.id ?? 0;

    const res = handle({
      method: 'POST',
      path: '/orders',
      body: { customer_id: 1, items: [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 1 }] },
    });
    assert.equal(res.status, 201);
    assert.ok(res.payload.order_id > maxId);
    assert.equal(res.payload.customer_id, 1);
    assert.ok(res.payload.total > 0);

    const detail = handle({ method: 'GET', path: `/orders/${res.payload.order_id}` });
    assert.equal(detail.status, 200);
    assert.equal(detail.payload.order.id, res.payload.order_id);
    assert.equal(detail.payload.items.length, 2);
  });

  it('rejects order for unknown customer', () => {
    const res = handle({
      method: 'POST',
      path: '/orders',
      body: { customer_id: 999999, items: [{ product_id: 1, quantity: 1 }] },
    });
    assert.equal(res.status, 400);
  });

  it('rejects order with unknown product', () => {
    const res = handle({
      method: 'POST',
      path: '/orders',
      body: { customer_id: 1, items: [{ product_id: 999999, quantity: 1 }] },
    });
    assert.equal(res.status, 400);
  });
});
