const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERSON_NAME_REGEX = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/u;
const SEARCH_REGEX = /^[A-Za-zА-Яа-яЁё0-9\-\s]*$/u;
const SQL_INJECTION_REGEX = /(\b(select|insert|update|delete|drop|alter|truncate|union|exec|script)\b|--|;|\/\*|\*\/)/iu;
const HTML_TAG_REGEX = /<[^>]*>/u;

function normalizeText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateEmail(email) {
  const normalizedEmail = normalizeText(email).toLowerCase();

  if (!normalizedEmail) {
    return { value: normalizedEmail, error: 'Введите email' };
  }

  if (normalizedEmail.length > 254 || !EMAIL_REGEX.test(normalizedEmail)) {
    return { value: normalizedEmail, error: 'Введите корректный email, например name@example.com' };
  }

  return { value: normalizedEmail, error: null };
}

function validatePersonName(value, fieldLabel = 'Имя') {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return { value: normalizedValue, error: `${fieldLabel} обязательно для заполнения` };
  }

  if (normalizedValue.length < 2 || normalizedValue.length > 30) {
    return { value: normalizedValue, error: `${fieldLabel} должно содержать от 2 до 30 символов` };
  }

  if (!PERSON_NAME_REGEX.test(normalizedValue)) {
    return {
      value: normalizedValue,
      error: `${fieldLabel} может содержать только буквы кириллицы/латиницы, дефис внутри слова и пробел между словами`
    };
  }

  return { value: normalizedValue, error: null };
}

function validatePassword(password) {
  const value = String(password || '');

  if (!value) {
    return { value, error: 'Введите пароль' };
  }

  if (value.length < 4 || !/[0-9]/.test(value) || !/[A-ZА-ЯЁ]/u.test(value) || !/[a-zа-яё]/u.test(value)) {
    return {
      value,
      error: 'Пароль должен содержать минимум 4 символа, включая цифру и заглавную букву'
    };
  }

  if (value.length > 128) {
    return { value, error: 'Пароль не должен быть длиннее 128 символов' };
  }

  return { value, error: null };
}

function validateSearchQuery(value, fieldLabel = 'Поисковый запрос') {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return { value: normalizedValue, error: null };
  }

  if (normalizedValue.length > 100) {
    return { value: normalizedValue, error: `${fieldLabel} должен быть не длиннее 100 символов` };
  }

  if (HTML_TAG_REGEX.test(normalizedValue)) {
    return { value: normalizedValue, error: `${fieldLabel} не должен содержать HTML-теги` };
  }

  if (SQL_INJECTION_REGEX.test(normalizedValue)) {
    return { value: normalizedValue, error: `${fieldLabel} содержит запрещённую SQL/служебную конструкцию` };
  }

  if (!SEARCH_REGEX.test(normalizedValue)) {
    return { value: normalizedValue, error: `${fieldLabel} может содержать только буквы, цифры, пробел и дефис` };
  }

  return { value: normalizedValue, error: null };
}

function validatePlainText(value, fieldLabel, { min = 0, max = 5000, required = false } = {}) {
  const normalizedValue = String(value || '').trim();

  if (required && !normalizedValue) {
    return { value: normalizedValue, error: `${fieldLabel} обязательно для заполнения` };
  }

  if (normalizedValue && normalizedValue.length < min) {
    return { value: normalizedValue, error: `${fieldLabel} должно содержать минимум ${min} символов` };
  }

  if (normalizedValue.length > max) {
    return { value: normalizedValue, error: `${fieldLabel} не должно быть длиннее ${max} символов` };
  }

  if (HTML_TAG_REGEX.test(normalizedValue)) {
    return { value: normalizedValue, error: `${fieldLabel} не должно содержать HTML-теги` };
  }

  return { value: normalizedValue, error: null };
}

module.exports = {
  EMAIL_REGEX,
  PERSON_NAME_REGEX,
  SEARCH_REGEX,
  validateEmail,
  validatePersonName,
  validatePassword,
  validateSearchQuery,
  validatePlainText,
  normalizeText
};
