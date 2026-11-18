'use strict';

/**
 * Быстрая отметка прогресса без перезагрузки страницы.
 *
 * Работает как улучшение: если скрипт не загрузился или упал, форма
 * отправится обычным способом и страница просто перезагрузится.
 * Ответ сервера — JSON с полями percent, progressPages, statusLabel.
 */
(function () {
  var forms = document.querySelectorAll('[data-progress-form]');
  if (!forms.length) return;

  /** Ширина полосы задаётся классом шага (5%): CSS-переменные из JS не нужны. */
  function stepClass(percent) {
    var step = Math.min(20, Math.max(0, Math.ceil((Number(percent) || 0) / 5)));
    return 'progress__bar progress__bar--step' + step;
  }

  forms.forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!window.fetch) return;
      event.preventDefault();

      var item = form.closest('.shelf-item');
      var button = form.querySelector('button[type="submit"]');
      if (button) button.setAttribute('aria-disabled', 'true');

      fetch(form.action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        body: new URLSearchParams(new FormData(form)).toString(),
        credentials: 'same-origin'
      })
        .then(function (response) { return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        }); })
        .then(function (result) {
          if (!result.ok) throw new Error(result.data.error || 'Не получилось сохранить');
          if (!item) return;
          var bar = item.querySelector('[data-progress-bar]');
          var percent = item.querySelector('[data-progress-percent]');
          var pages = item.querySelector('[data-progress-pages]');
          if (bar) bar.className = stepClass(result.data.percent);
          if (percent) percent.textContent = result.data.percent + '%';
          if (pages) {
            pages.textContent = result.data.progressPages +
              (result.data.totalPages ? ' из ' + result.data.totalPages : '') + ' стр.';
          }
          var pill = item.querySelector('.pill');
          if (pill) pill.textContent = result.data.statusLabel;
          item.setAttribute('data-saved', 'true');
        })
        .catch(function (error) {
          // Не смогли — отправляем как обычно, чтобы человек не остался без результата
          if (window.console) console.warn('быстрая отметка не сработала:', error.message);
          form.submit();
        })
        .finally(function () {
          if (button) button.removeAttribute('aria-disabled');
        });
    });
  });
}());
