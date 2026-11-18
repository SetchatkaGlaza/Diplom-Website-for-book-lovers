'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Review } = require('../../src/models');

test('оценка в половинных шагах: 3.5 -> 7 -> 3.5', () => {
  assert.equal(Review.toRatingValue(3.5), 7);
  assert.equal(Review.toRatingValue(1), 2);
  assert.equal(Review.toRatingValue(5), 10);
  assert.equal(Review.toRatingValue(4.5), 9);
});

test('оценка не по шагу 0.5 и вне диапазона отвергается', () => {
  assert.equal(Review.toRatingValue(4.2), null);
  assert.equal(Review.toRatingValue(0.5), null);
  assert.equal(Review.toRatingValue(5.5), null);
  assert.equal(Review.toRatingValue('abc'), null);
  assert.equal(Review.toRatingValue(NaN), null);
});

test('getStars переводит обратно в звёзды', () => {
  const review = Review.build({ rating: 7 });
  assert.equal(review.getStars(), 3.5);
  const whole = Review.build({ rating: 10 });
  assert.equal(whole.getStars(), 5);
});
