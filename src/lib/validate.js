'use strict';

/**
 * Валидация входных данных.
 *
 * Все функции возвращают { value } или { error } — никогда не бросают.
 * Ошибки на русском и адресованы человеку, а не разработчику:
 * «Похоже, в адресе опечатка. Пример: reader@mail.ru» лучше, чем «invalid email».
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё' -]{1,59}$/u;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/** Самые частые пароли: злоумышленники пробуют их первыми. */
const WEAK_PASSWORDS = /^(password|passwd|qwerty|qwer|1234|12345|123456|admin|letmein|iloveyou|welcome|monkey|dragon|111111|000000|abc123)/i;

/** Убирает управляющие символы и лишние пробелы, ограничивает длину. */
function str(value, max = 10000) {
  return String(value ?? '')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, max);
}

function email(value) {
  const v = str(value, 254).toLowerCase();
  if (!v) return { error: 'Введите e-mail' };
  if (!EMAIL.test(v)) return { error: 'Похоже, в адресе опечатка. Пример: reader@mail.ru' };
  const [local, domain] = v.split('@');
  if (local.length > 64) return { error: 'Слишком длинная часть адреса до @' };
  if (domain.includes('..')) return { error: 'В адресе две точки подряд' };
  return { value: v };
}

function name(value) {
  const v = str(value, 60).replace(/\s+/g, ' ');
  if (v.length < 2) return { error: 'Имя должно быть не короче 2 символов' };
  if (!NAME.test(v)) return { error: 'В имени допустимы буквы, пробел, дефис и апостроф' };
  return { value: v };
}

function password(value) {
  const v = String(value ?? '');
  if (v.length < PASSWORD_MIN) return { error: `Пароль должен быть не короче ${PASSWORD_MIN} символов` };
  if (v.length > PASSWORD_MAX) return { error: 'Пароль слишком длинный' };
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(v) || !/\d/.test(v)) {
    return { error: 'Пароль должен содержать хотя бы одну букву и одну цифру' };
  }
  if (WEAK_PASSWORDS.test(v)) {
    return { error: 'Слишком простой пароль: он есть в списках у злоумышленников' };
  }
  return { value: v };
}

/** Пароль из формы регистрации/смены: проверка + подтверждение. */
function passwordPair(value, confirmation) {
  const result = password(value);
  if (result.error) return result;
  if (String(value) !== String(confirmation)) return { error: 'Пароли не совпадают' };
  return result;
}

function text(value, { min = 0, max = 5000, field = 'Поле', required = false } = {}) {
  const v = str(value, max + 200);
  if (required && !v) return { error: `${field}: заполните поле` };
  if (v && v.length < min) return { error: `${field}: минимум ${min} символов` };
  if (v.length > max) return { error: `${field}: максимум ${max} символов` };
  return { value: v };
}

function int(value, { min = 0, max = Number.MAX_SAFE_INTEGER, field = 'Значение' } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return { error: `${field}: ожидается число` };
  if (n < min || n > max) return { error: `${field}: допустимый диапазон ${min}–${max}` };
  return { value: n };
}

/** Оценка в звёздах: 1–5 с шагом 0.5. */
function rating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 5) return { error: 'Оценка должна быть от 1 до 5' };
  if (Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) return { error: 'Оценка ставится с шагом 0.5' };
  return { value: n };
}

function oneOf(value, allowed, field = 'Значение') {
  if (!allowed.includes(value)) return { error: `${field}: недопустимое значение` };
  return { value };
}

function bool(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

/** Слаг из адреса: только латиница, цифры и дефис. */
function slug(value) {
  const v = str(value, 120).toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(v)) return { error: 'Некорректный адрес' };
  return { value: v };
}

module.exports = {
  EMAIL,
  PASSWORD_MIN,
  PASSWORD_MAX,
  str,
  email,
  name,
  password,
  passwordPair,
  text,
  int,
  rating,
  oneOf,
  bool,
  slug
};
