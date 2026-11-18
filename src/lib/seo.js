'use strict';

/**
 * Хелперы разметки для поисковиков.
 *
 * JSON-LD кладём в <script type="application/ld+json"> с nonce из CSP:
 * 'unsafe-inline' не включаем, а разметку нельзя вынести в файл — она
 * зависит от страницы.
 */

/** JSON.stringify с экранированием < — иначе `</script>` в тексте сломает страницу. */
function jsonLd(data) {
  return JSON.stringify(data, (key, value) => (value === undefined ? undefined : value))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function bookJsonLd(book, base) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.title,
    author: { '@type': 'Person', name: book.author },
    numberOfPages: book.pages || undefined,
    inLanguage: 'ru',
    url: `${base}/knigi/${book.slug}`,
    ...(book.ratingsCount
      ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: book.rating || 0,
          ratingCount: book.ratingsCount,
          bestRating: 5,
          worstRating: 1
        }
      }
      : {})
  });
}

function reviewJsonLd(review) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Review',
    itemReviewed: { '@type': 'Book', name: String(review.bookTitle || '') },
    reviewRating: {
      '@type': 'Rating',
      ratingValue: Number(review.rating) || 0,
      bestRating: 5,
      worstRating: 1
    },
    author: { '@type': 'Person', name: String(review.authorName || 'Читатель') },
    reviewBody: String(review.body || '').slice(0, 500),
    datePublished: review.createdAt ? new Date(review.createdAt).toISOString().slice(0, 10) : undefined
  });
}

module.exports = { jsonLd, bookJsonLd, reviewJsonLd };
