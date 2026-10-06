import { DatabaseSync } from 'node:sqlite';
import { setupSchema } from '../src/index.js';

export const COUNTS = {
  customers: 10_000,
  products: 5_000,
  orders: 50_000,
  order_items: 150_000,
  reviews: 25_000,
};

const CITIES = [
  'Berlin', 'Paris', 'Madrid', 'Rome', 'Amsterdam', 'Vienna', 'Lisbon', 'Prague',
  'Warsaw', 'Budapest', 'Copenhagen', 'Stockholm', 'Helsinki', 'Oslo', 'Dublin',
  'Brussels', 'Zurich', 'Milan', 'Barcelona', 'Munich',
];

const CATEGORIES = ['electronics', 'books', 'clothing', 'home', 'sports', 'toys', 'food'];

const ORDER_STATUSES = ['pending', 'shipped', 'delivered', 'cancelled'];

function makeLcg(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (1103515245 * s + 12345) >>> 0;
    return s / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function randomDate(rng, startYear = 2020, endYear = 2024) {
  const start = new Date(startYear, 0, 1).getTime();
  const end = new Date(endYear, 11, 31).getTime();
  return Math.floor(start + rng() * (end - start));
}

function makeBulkInsert(db, table, columns, rows, batchSize = 100) {
  const colList = columns.join(', ');
  const placeholder = `(${columns.map(() => '?').join(', ')})`;
  db.exec('BEGIN TRANSACTION');
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const sql = `INSERT INTO ${table} (${colList}) VALUES ${chunk.map(() => placeholder).join(', ')}`;
    const stmt = db.prepare(sql);
    const args = chunk.flat();
    stmt.run(...args);
  }
  db.exec('COMMIT');
}

export function generateBaseDatabase(path, seed = 42, counts = COUNTS) {
  const db = new DatabaseSync(path);
  setupSchema(db);

  const rng = makeLcg(seed);

  // customers
  const customers = [];
  for (let i = 1; i <= counts.customers; i++) {
    customers.push([
      `Customer ${i}`,
      `customer${i}@example.com`,
      pick(rng, CITIES),
      randomDate(rng),
    ]);
  }
  makeBulkInsert(db, 'customers', ['name', 'email', 'city', 'created_at'], customers);

  // products
  const products = [];
  for (let i = 1; i <= counts.products; i++) {
    products.push([
      `Product ${i}`,
      pick(rng, CATEGORIES),
      Math.round((rng() * 200 + 5) * 100) / 100,
      Math.floor(rng() * 500),
      `A ${pick(rng, CATEGORIES)} item described as product number ${i}.`,
    ]);
  }
  makeBulkInsert(db, 'products', ['name', 'category', 'price', 'stock', 'description'], products);

  // orders
  const orders = [];
  for (let i = 1; i <= counts.orders; i++) {
    orders.push([
      Math.floor(rng() * counts.customers) + 1,
      pick(rng, ORDER_STATUSES),
      0,
      randomDate(rng),
    ]);
  }
  makeBulkInsert(db, 'orders', ['customer_id', 'status', 'total', 'created_at'], orders);

  // order_items
  const items = [];
  let orderId = 1;
  for (let i = 1; i <= counts.order_items; i++) {
    if (rng() < 0.02 && orderId < counts.orders) orderId++;
    items.push([
      orderId,
      Math.floor(rng() * counts.products) + 1,
      Math.floor(rng() * 5) + 1,
      Math.round((rng() * 200 + 5) * 100) / 100,
    ]);
  }
  makeBulkInsert(db, 'order_items', ['order_id', 'product_id', 'quantity', 'unit_price'], items);

  // reviews
  const reviews = [];
  for (let i = 1; i <= counts.reviews; i++) {
    reviews.push([
      Math.floor(rng() * counts.products) + 1,
      Math.floor(rng() * counts.customers) + 1,
      Math.floor(rng() * 5) + 1,
      `Review ${i} for product ${Math.floor(rng() * counts.products) + 1}`,
      randomDate(rng),
    ]);
  }
  makeBulkInsert(db, 'reviews', ['product_id', 'customer_id', 'rating', 'body', 'created_at'], reviews);

  db.close();
}
