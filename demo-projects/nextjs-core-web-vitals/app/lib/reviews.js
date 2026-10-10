/**
 * Review list logic. Pure functions — shared by the application and the
 * unit tests (`test/reviews.test.js`).
 */

export function filterReviews(reviews, query) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return reviews;
  return reviews.filter((review) => review.text.toLowerCase().includes(needle));
}

const WORD_SPLIT = /[^a-z0-9]+/;

/**
 * Relevance score for one review against the query terms.
 *
 * The score weights the rating, how often each term appears in the text and
 * how early it appears. It re-tokenizes the review text on every call.
 */
export function scoreReview(review, terms) {
  if (terms.length === 0) return review.rating;
  const words = review.text.toLowerCase().split(WORD_SPLIT).filter(Boolean);
  let score = review.rating * 2;
  for (const term of terms) {
    let hits = 0;
    for (const word of words) {
      if (word.startsWith(term)) hits += 1;
    }
    score += hits * 3;
  }
  const first = review.text.toLowerCase().indexOf(terms[0]);
  if (first >= 0) score += Math.max(0, 10 - Math.floor(first / 10));
  return score;
}

/** Highest relevance first; ties break on the review id so the order is stable. */
export function sortReviews(reviews, query = '') {
  const terms = query
    .trim()
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter(Boolean);
  return [...reviews].sort(
    (a, b) =>
      scoreReview(b, terms) - scoreReview(a, terms) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function filterAndSortReviews(reviews, query) {
  return sortReviews(filterReviews(reviews, query), query);
}
