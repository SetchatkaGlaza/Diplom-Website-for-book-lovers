'use strict';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const MONTHS_NOMINATIVE = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/**
 * Русское склонение: plural(5, ['книга', 'книги', 'книг']) -> 'книг'
 * Правило: 11–14 всегда третья форма, затем последняя цифра 1 / 2–4 / иначе.
 */
function plural(n, forms) {
  if (!Array.isArray(forms) || forms.length !== 3) {
    throw new TypeError('plural ожидает массив из трёх форм');
  }
  const value = Math.abs(Number(n) || 0);
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function count(n, forms) {
  return `${Number(n) || 0} ${plural(n, forms)}`;
}

function books(n) { return count(n, ['книга', 'книги', 'книг']); }
function reviews(n) { return count(n, ['рецензия', 'рецензии', 'рецензий']); }
function readers(n) { return count(n, ['читатель', 'читателя', 'читателей']); }
function pages(n) { return count(n, ['страница', 'страницы', 'страниц']); }
function days(n) { return count(n, ['день', 'дня', 'дней']); }

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function formatShortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function monthName(index) {
  return MONTHS_NOMINATIVE[index] || '';
}

function timeAgo(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн назад`;
  return formatShortDate(value);
}

function truncate(value, max = 200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

function initials(name = '') {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function ratingLabel(value) {
  const rating = Number(value) || 0;
  if (rating >= 4.5) return 'шедевр';
  if (rating >= 4) return 'очень хорошо';
  if (rating >= 3) return 'нормально';
  if (rating >= 2) return 'слабо';
  if (rating > 0) return 'плохо';
  return 'без оценок';
}

module.exports = {
  plural, count, books, reviews, readers, pages, days,
  formatDate, formatShortDate, timeAgo, truncate, initials, ratingLabel, monthName,
  MONTHS, MONTHS_NOMINATIVE
};
