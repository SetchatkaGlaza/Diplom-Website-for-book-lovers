'use strict';
/* eslint-disable */
/**
 * Движение по всему сайту: появление блоков, счётчики, наклон полки,
 * живая обложка на странице книги, «чернильный» подчёркиватель.
 *
 * Правила, от которых не отступаем:
 *  - работает без JS: всё, что скрыто до появления, скрыто только если
 *    JS добавил класс `.js-anim` на <html>. Сервер отдаёт обычный HTML;
 *  - уважает `prefers-reduced-motion`: при включённой настройке анимаций нет;
 *  - не блокирует клики и не мешает выделению текста;
 *  - CSP: никаких inline-обработчиков, только этот файл.
 */
(function () {
  var root = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  root.classList.add('js-anim');

  // ---------- 1. Появление блоков при прокрутке ----------
  function initReveal() {
    var nodes = document.querySelectorAll('[data-reveal], .section > .container > *');
    if (!nodes.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      nodes.forEach(function (node) { node.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        // Задержка по индексу внутри группы: блоки выезжают лесенкой,
        // а не все сразу — это дешевле, чем transition-delay на каждый
        var index = Number(el.dataset.revealIndex || 0);
        el.style.transitionDelay = Math.min(index * 60, 240) + 'ms';
        el.classList.add('is-visible');
        observer.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    var groups = {};
    nodes.forEach(function (node) {
      node.classList.add('reveal');
      var parent = node.parentElement || document.body;
      var key = parent.className || parent.tagName;
      groups[key] = (groups[key] || 0) + 1;
      node.dataset.revealIndex = String(Math.min(groups[key], 6));
      observer.observe(node);
    });
  }

  // ---------- 2. Счётчики цифр ----------
  function initCounters() {
    var counters = document.querySelectorAll('[data-count]');
    if (!counters.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        animateNumber(el);
        observer.unobserve(el);
      });
    }, { threshold: 0.4 });

    counters.forEach(function (el) { observer.observe(el); });
  }

  function animateNumber(el) {
    var target = Number(el.dataset.count);
    if (!isFinite(target)) return;
    var suffix = el.dataset.countSuffix || '';
    var duration = 900;
    var start = performance.now();

    function frame(now) {
      var progress = Math.min(1, (now - start) / duration);
      // easeOutCubic: быстро в начале, мягко в конце
      var eased = 1 - Math.pow(1 - progress, 3);
      var value = Math.round(target * eased);
      el.textContent = String(value) + suffix;
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------- 3. Наклон карточек под курсором ----------
  function initTilt() {
    if (reduceMotion) return;
    // На тач-устройствах наклон не нужен: там нет курсора
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;

    document.querySelectorAll('.book-card').forEach(function (card) {
      var cover = card.querySelector('.book-card__cover');
      if (!cover) return;

      card.addEventListener('pointermove', function (event) {
        var rect = cover.getBoundingClientRect();
        var dx = (event.clientX - rect.left) / rect.width - 0.5;
        var dy = (event.clientY - rect.top) / rect.height - 0.5;
        cover.style.transform = 'perspective(700px) rotateY(' + (dx * 9).toFixed(2) + 'deg) rotateX('
          + (-dy * 9).toFixed(2) + 'deg) translateY(-3px)';
      });

      card.addEventListener('pointerleave', function () {
        cover.style.transform = '';
      });
    });
  }

  // ---------- 4. Книга на странице открывается «в руках» ----------
  function initBookOpen() {
    var cover = document.querySelector('.book-page__cover .book-cover__image');
    if (!cover) return;
    cover.classList.add('book-open');
    // Класс снимаем после анимации: дальше обложка живёт по CSS-наведению
    setTimeout(function () { cover.classList.add('book-open--done'); }, 1200);
  }

  // ---------- 5. Подчёркивание ссылок «чернилами» ----------
  function initInk() {
    if (reduceMotion) return;
    document.querySelectorAll('.site-footer a, .lede a, .article__paragraph a').forEach(function (link) {
      link.classList.add('ink-link');
    });
  }

  // ---------- 6. Липкая шапка: тень после прокрутки ----------
  function initHeader() {
    var header = document.querySelector('.site-header');
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle('site-header--scrolled', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ---------- 7. Таблица прогресса чтения «оживает» ----------
  function initProgress() {
    document.querySelectorAll('.progress__bar').forEach(function (bar) {
      bar.classList.add('progress__bar--animated');
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    initHeader();
    initReveal();
    initCounters();
    initTilt();
    initBookOpen();
    initInk();
    initProgress();
  });
})();
