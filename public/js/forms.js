'use strict';
/* eslint-disable */
/**
 * Формы входа и регистрации: показать/скрыть пароль и индикатор надёжности.
 *
 * Почему отдельный файл, а не инлайн-скрипт: CSP запрещает встроенные
 * обработчики, и тест design.test.js это проверяет.
 * Без JS формы работают как обычно — кнопка просто не появится в поведении,
 * а type="password" останется.
 */
(function () {
  function initToggles() {
    document.querySelectorAll('[data-password-toggle]').forEach(function (button) {
      var input = document.getElementById(button.dataset.target);
      if (!input) return;

      button.addEventListener('click', function () {
        var shown = input.type === 'text';
        input.type = shown ? 'password' : 'text';
        button.setAttribute('aria-pressed', String(!shown));
        button.setAttribute('aria-label', shown ? 'Показать пароль' : 'Скрыть пароль');
        var icon = button.querySelector('[data-password-icon]');
        if (icon) icon.textContent = shown ? '◉' : '◍';
        // Возвращаем курсор в поле: иначе фокус «прыгает» на кнопку
        input.focus({ preventScroll: true });
      });
    });
  }

  /**
   * Оценка пароля: 0–4. Считаем не «энтропию по учебнику», а то, что
   * человек может исправить: длина, разные классы символов, не однообразный.
   */
  function score(value) {
    if (!value) return 0;
    var points = 0;
    if (value.length >= 8) points += 1;
    if (value.length >= 12) points += 1;
    if (/[a-zа-я]/.test(value) && /[A-ZА-Я]/.test(value)) points += 1;
    if (/\d/.test(value)) points += 1;
    if (/[^\w\s]/.test(value)) points += 1;
    if (/^(.)\1+$/.test(value)) points = 1;          // «аааааааа»
    if (/^(123456|qwerty|password|пароль|йцукен)/i.test(value)) points = Math.min(points, 1);
    return Math.max(0, Math.min(4, points - 1 + (value.length >= 8 ? 1 : 0)));
  }

  var LABELS = ['', 'слабый', 'так себе', 'хороший', 'надёжный'];

  function initMeters() {
    document.querySelectorAll('[data-pass-meter]').forEach(function (meter) {
      var field = meter.closest('.field');
      var input = field && field.querySelector('input[type="password"], input[data-password-input]');
      var text = field && field.querySelector('[data-pass-text]');
      if (!input) return;

      var update = function () {
        var value = input.value || '';
        var level = value ? score(value) : 0;
        meter.querySelectorAll('.pass-meter__seg').forEach(function (seg, index) {
          seg.classList.toggle('is-' + level, index < level);
        });
        if (!text) return;
        if (!value) {
          text.textContent = 'Надёжность пароля появится, когда начнёте вводить';
          return;
        }
        text.textContent = 'Надёжность: ' + (LABELS[level] || 'слабый')
          + (level >= 3 ? ' — можно сохранять' : ' — добавьте длину или цифры');
      };

      input.addEventListener('input', update);
      update();
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    initToggles();
    initMeters();
  });
})();
