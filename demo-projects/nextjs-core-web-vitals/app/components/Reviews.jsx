'use client';

import { useEffect, useState } from 'react';
import { getReviews } from '../lib/data.js';
import { filterAndSortReviews } from '../lib/reviews.js';

export function Reviews({ seed, pimUrl }) {
  const [reviews, setReviews] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    getReviews(pimUrl, seed)
      .then((payload) => {
        if (!cancelled) setReviews(payload.reviews);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pimUrl, seed]);

  const visible = filterAndSortReviews(reviews ?? [], query);

  return (
    <section className="reviews">
      <h2>
        Reviews{' '}
        {reviews ? <span data-bench-part="review-count">({reviews.length})</span> : null}
      </h2>
      <label className="filter-label" htmlFor="review-filter">
        Search reviews
      </label>
      <input
        id="review-filter"
        data-bench="filter"
        type="search"
        placeholder="Try a keyword"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="filter-count" data-bench-part="filter-count">
        {reviews ? `Showing ${visible.length} of ${reviews.length}` : 'Loading reviews…'}
      </p>
      <ul className="review-list">
        {visible.map((review) => (
          <li key={review.id} className="review" data-bench-part="review-row" data-review-id={review.id}>
            <div className="review-head">
              <span className="review-author">{review.author}</span>
              <span className="review-rating" aria-label={`${review.rating} out of 5`}>
                {'★'.repeat(review.rating)}
                {'☆'.repeat(5 - review.rating)}
              </span>
            </div>
            <p className="review-text">{review.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
