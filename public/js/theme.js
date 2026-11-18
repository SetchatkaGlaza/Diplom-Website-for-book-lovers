'use strict';

/**
 * Две мелочи без библиотек:
 *  1) переключение светлой и тёмной темы с запоминанием в cookie;
 *  2) раскрытие меню на телефоне.
 *
 * Файл подключается с defer и не блокирует отрисовку. Если JS выключен,
 * сайт работает: тема остаётся светлой, меню на мобиле — скрыто (ссылки
 * из него дублируются в нижней панели и в подвале).
 */
(function () {
  var root = document.documentElement;

  function readCookie(name) {
    var parts = String(document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i += 1) {
      var index = parts[i].indexOf('=');
      if (index < 0) continue;
      if (parts[i].slice(0, index).trim() === name) {
        return decodeURIComponent(parts[i].slice(index + 1).trim());
      }
    }
    return null;
  }

  function writeCookie(name, value) {
    // Полгода, на весь сайт; SameSite=Lax достаточно: это не секрет
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; path=/; max-age=' + 60 * 60 * 24 * 180 + '; SameSite=Lax';
  }

  var toggle = document.getElementById('theme-toggle');
  var icon = document.getElementById('theme-toggle-icon');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      writeCookie('theme', next);
      if (icon) icon.textContent = next === 'dark' ? '☀' : '☾';
      toggle.setAttribute('aria-label',
        next === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
    });
    if (readCookie('theme')) {
      toggle.setAttribute('aria-label', root.getAttribute('data-theme') === 'dark'
        ? 'Включить светлую тему'
        : 'Включить тёмную тему');
    }
  }

  var navToggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('site-nav');
  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      navToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    });
  }
}());
