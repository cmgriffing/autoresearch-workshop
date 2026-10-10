import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAndSortReviews,
  filterReviews,
  scoreReview,
  sortReviews,
} from '../app/lib/reviews.js';

const rows = [
  { id: 'r1', rating: 3, text: 'Pairs over wireless with the app.' },
  { id: 'r2', rating: 5, text: 'Great lamp, no complaints.' },
  { id: 'r3', rating: 4, text: 'WIRELESS setup took a minute.' },
  { id: 'r4', rating: 5, text: 'Solid build and nice light.' },
];

test('filterReviews matches case-insensitively and trims the query', () => {
  assert.deepEqual(
    filterReviews(rows, '  Wireless ').map((row) => row.id),
    ['r1', 'r3'],
  );
  assert.deepEqual(filterReviews(rows, 'wireless').map((row) => row.id), ['r1', 'r3']);
});

test('filterReviews returns every row for an empty query', () => {
  assert.equal(filterReviews(rows, '   ').length, rows.length);
});

test('filterReviews returns nothing when no row matches', () => {
  assert.deepEqual(filterReviews(rows, 'dimmable'), []);
});

test('scoreReview without terms is the rating itself', () => {
  assert.equal(scoreReview({ id: 'x', rating: 5, text: 'aaa bbb' }, []), 5);
});

test('scoreReview rewards term hits and early placement', () => {
  assert.equal(scoreReview({ id: 'x', rating: 1, text: 'aaa bbb' }, ['aaa']), 15);
  const early = scoreReview({ id: 'x', rating: 1, text: 'aaa bbb' }, ['bbb']);
  const late = scoreReview({ id: 'x', rating: 1, text: 'cccccccccccccc bbb' }, ['bbb']);
  assert.ok(early > late);
});

test('sortReviews orders by descending relevance', () => {
  // r3 matches the term at position 0 (highest placement bonus); r1 matches later.
  assert.ok(scoreReview(rows[2], ['wireless']) > scoreReview(rows[0], ['wireless']));
  const ordered = sortReviews(rows, 'wireless').map((row) => row.id);
  assert.deepEqual(ordered.slice(0, 2), ['r3', 'r1']);
});

test('sortReviews breaks ties on the review id', () => {
  const tied = [
    { id: 'r9', rating: 4, text: 'same text' },
    { id: 'r2', rating: 4, text: 'same text' },
    { id: 'r5', rating: 4, text: 'same text' },
  ];
  assert.deepEqual(sortReviews(tied, '').map((row) => row.id), ['r2', 'r5', 'r9']);
});

test('filterAndSortReviews narrows to exactly the matching rows', () => {
  const visible = filterAndSortReviews(rows, 'wireless');
  assert.equal(visible.length, 2);
  assert.deepEqual([...visible.map((row) => row.id)].sort(), ['r1', 'r3']);
});
