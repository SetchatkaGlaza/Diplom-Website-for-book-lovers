'use strict';

/**
 * Лайк без перезагрузки: кнопка сразу показывает новое число.
 * Если скрипт недоступен, форма отправится обычным способом — редирект вернёт на страницу.
 */
(function () {
  var forms = document.querySelectorAll('[data-like-form]');
  if (!forms.length || !window.fetch) return;

  forms.forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var button = form.querySelector('button[type="submit"]');
      var counter = form.querySelector('[data-likes-count]');
      if (button) button.setAttribute('aria-disabled', 'true');

      fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(new FormData(form)).toString(),
        credentials: 'same-origin'
      })
        .then(function (response) {
          if (response.status === 401 || response.redirected) throw new Error('нужен вход');
          return response.json();
        })
        .then(function (data) {
          if (counter) counter.textContent = data.likesCount;
          if (button) button.setAttribute('aria-pressed', data.liked ? 'true' : 'false');
        })
        .catch(function () {
          form.submit();
        })
        .finally(function () {
          if (button) button.removeAttribute('aria-disabled');
        });
    });
  });
}());
