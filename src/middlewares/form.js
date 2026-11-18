'use strict';

/**
 * Разбор форм: собираем ошибки валидации и возвращаем их в шаблон.
 *
 * Правила:
 *  - валидация только на сервере, клиентская — лишь подсказка;
 *  - при ошибке форма перерисовывается с введёнными значениями (req.formData);
 *  - пароль обратно в поле не возвращаем никогда.
 */

function pick(source, fields) {
  const data = {};
  for (const field of fields) {
    data[field] = source?.[field];
  }
  return data;
}

/**
 * @param {object} schema  объект { поле: (value) => ({ value }) | ({ error }) }
 * @param {string[]} keep  поля, которые нужно вернуть в форму (кроме паролей)
 */
function validateBody(schema, keep = []) {
  return function validateForm(req, res, next) {
    const errors = {};
    const data = {};

    for (const [field, rule] of Object.entries(schema)) {
      const result = rule(req.body?.[field], req.body);
      if (result && result.error) errors[field] = result.error;
      else if (result) data[field] = result.value;
    }

    req.formData = data;
    req.formErrors = errors;
    res.locals.errors = errors;
    res.locals.formData = pick(req.body, keep);
    return next();
  };
}

/** Форма с ошибками: отдаём тот же шаблон со статусом 422. */
function renderWithErrors(view, extra = {}) {
  return function renderForm(req, res) {
    if (!Object.keys(req.formErrors || {}).length) return undefined;
    return res.status(422).render(view, { ...extra, formData: res.locals.formData });
  };
}

module.exports = { validateBody, renderWithErrors, pick };
