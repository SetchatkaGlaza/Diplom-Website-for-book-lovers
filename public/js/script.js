document.addEventListener('DOMContentLoaded', () => {
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const navMenu = document.getElementById('nav-menu');

  if (mobileMenuBtn && navMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      navMenu.classList.toggle('active');

      const icon = mobileMenuBtn.querySelector('i');
      if (navMenu.classList.contains('active')) {
        icon.className = 'fas fa-times';
        document.body.classList.add('menu-open');
      } else {
        icon.className = 'fas fa-bars';
        document.body.classList.remove('menu-open');
      }
    });

    navMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
        const icon = mobileMenuBtn.querySelector('i');
        icon.className = 'fas fa-bars';
        document.body.classList.remove('menu-open');
      });
    });
  }

  const statNumbers = document.querySelectorAll('.stat-number');

  statNumbers.forEach(stat => {
    const target = parseInt(stat.textContent);
    if (target > 0) {
      let current = 0;
      const increment = target / 50;
      const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
          stat.textContent = target.toLocaleString();
          clearInterval(timer);
        } else {
          stat.textContent = Math.floor(current).toLocaleString();
        }
      }, 30);
    }
  });

  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  const currentLocation = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link');

  navLinks.forEach(link => {
    if (link.getAttribute('href') === currentLocation) {
      link.classList.add('active');
    }
  });

  const bottomNavLinks = document.querySelectorAll('.bottom-nav__item');
  bottomNavLinks.forEach(link => {
    const href = link.getAttribute('href');
    const isExact = href === currentLocation;
    const isSection = href !== '/' && currentLocation.startsWith(href);
    const isBooksSearch = href === '/books' && currentLocation.startsWith('/books');
    if (isExact || isSection || isBooksSearch) {
      link.classList.add('active');
    }
  });
});

window.addEventListener('scroll', () => {
  const elements = document.querySelectorAll('.book-card, .stat-item, .review-card');

  elements.forEach(element => {
    const elementTop = element.getBoundingClientRect().top;
    const elementBottom = element.getBoundingClientRect().bottom;

    if (elementTop < window.innerHeight && elementBottom > 0) {
      element.style.opacity = '1';
      element.style.transform = 'translateY(0)';
    }
  });
});

// Единая клиентская валидация всех форм и интерактивная смена темы
(() => {
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PERSON_NAME_REGEX = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/u;
  const SEARCH_REGEX = /^[A-Za-zА-Яа-яЁё0-9\-\s]*$/u;
  const SQL_INJECTION_REGEX = /(\b(select|insert|update|delete|drop|alter|truncate|union|exec|script)\b|--|;|\/\*|\*\/)/iu;
  const HTML_TAG_REGEX = /<[^>]*>/u;

  const setError = (field, message) => {
    field.classList.toggle('is-invalid', Boolean(message));
    const fieldKey = field.name || field.id;
    const container = field.closest('.password-wrapper') || field;
    let error = container.parentElement?.querySelector(`.field-error[data-for="${fieldKey}"]`);

    if (!error && message) {
      error = document.createElement('small');
      error.className = 'field-error';
      error.dataset.for = fieldKey;
      container.insertAdjacentElement('afterend', error);
    }

    if (error) {
      error.textContent = message || '';
      error.style.display = message ? 'block' : 'none';
    }
  };

  const isSearchField = (field) => ['search', 'q'].includes(field.name) || field.id?.includes('search');
  const isPersonNameField = (field) => ['name', 'first_name', 'last_name', 'middle_name'].includes(field.name);
  const isPasswordPolicyField = (field) => ['password', 'password2', 'password_confirm', 'new_password', 'confirm_password'].includes(field.name);

  const validateField = (field) => {
    if (field.disabled || field.type === 'hidden' || field.type === 'file' || field.type === 'submit' || field.type === 'button') {
      return '';
    }

    const value = field.value.trim();

    if (field.required && !value) {
      return 'Поле обязательно для заполнения';
    }

    if (!value) {
      return '';
    }

    if (field.type === 'email' && (!EMAIL_REGEX.test(value) || value.length > 254)) {
      return 'Введите корректный email, например name@example.com';
    }

    if (isPasswordPolicyField(field) && (value.length < 4 || !/[0-9]/.test(value) || !/[A-ZА-ЯЁ]/u.test(value) || !/[a-zа-яё]/u.test(value))) {
      return 'Пароль должен содержать минимум 4 символа, включая цифру и заглавную букву';
    }

    if (isPersonNameField(field) && !PERSON_NAME_REGEX.test(value)) {
      return 'Разрешены только буквы, дефис внутри слова и пробел между словами';
    }

    if (isSearchField(field)) {
      if (value.length > 100) return 'Поисковый запрос должен быть не длиннее 100 символов';
      if (HTML_TAG_REGEX.test(value)) return 'Поиск не должен содержать HTML-теги';
      if (SQL_INJECTION_REGEX.test(value)) return 'Поиск содержит запрещённую SQL/служебную конструкцию';
      if (!SEARCH_REGEX.test(value)) return 'Поиск может содержать только буквы, цифры, пробел и дефис';
    }

    if ((field.tagName === 'TEXTAREA' || field.type === 'text') && HTML_TAG_REGEX.test(value)) {
      return 'Поле не должно содержать HTML-теги';
    }

    if (field.type === 'date') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const maxDate = new Date(today);
      maxDate.setFullYear(maxDate.getFullYear() + 2);
      const selectedDate = new Date(value);

      if (selectedDate < today) return 'Дата не может быть раньше сегодняшнего дня';
      if (selectedDate > maxDate) return 'Дата не может быть позднее чем через 2 года';
    }

    return '';
  };

  const setupPhoneMask = (field) => {
    field.maxLength = 18;
    field.placeholder = '+7 (___) ___-__-__';
    field.addEventListener('input', () => {
      const digits = field.value.replace(/\D/g, '').replace(/^8/, '7').slice(0, 11);
      const localDigits = digits.startsWith('7') ? digits.slice(1) : digits;
      let value = '+7';
      if (localDigits.length > 0) value += ` (${localDigits.slice(0, 3)}`;
      if (localDigits.length >= 3) value += ')';
      if (localDigits.length > 3) value += ` ${localDigits.slice(3, 6)}`;
      if (localDigits.length > 6) value += `-${localDigits.slice(6, 8)}`;
      if (localDigits.length > 8) value += `-${localDigits.slice(8, 10)}`;
      field.value = value;
    });
  };

  const setupDateRange = (field) => {
    const today = new Date();
    const maxDate = new Date(today);
    maxDate.setFullYear(maxDate.getFullYear() + 2);
    field.min = field.min || today.toISOString().slice(0, 10);
    field.max = field.max || maxDate.toISOString().slice(0, 10);
  };

  document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('theme');

    const applyTheme = (theme) => {
      const isDark = theme === 'dark';
      document.body.classList.toggle('theme-dark', isDark);
      document.body.dataset.theme = isDark ? 'dark' : 'light';
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
      themeToggle?.setAttribute('aria-pressed', String(isDark));
      const icon = themeToggle?.querySelector('i');
      if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    };

    applyTheme(savedTheme || 'light');

    themeToggle?.addEventListener('click', () => {
      const nextTheme = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
      applyTheme(nextTheme);
      localStorage.setItem('theme', nextTheme);
    });

    document.querySelectorAll('input[type="tel"]').forEach(setupPhoneMask);
    document.querySelectorAll('input[type="date"]').forEach(setupDateRange);

    document.querySelectorAll('input, textarea').forEach((field) => {
      if (isSearchField(field)) {
        field.maxLength = 100;
        field.pattern = '[A-Za-zА-Яа-яЁё0-9\\-\\s]*';
      }

      field.addEventListener('input', () => setError(field, validateField(field)));
      field.addEventListener('blur', () => setError(field, validateField(field)));
    });

    document.querySelectorAll('form').forEach((form) => {
      form.addEventListener('submit', (event) => {
        let firstInvalid = null;
        form.querySelectorAll('input, textarea, select').forEach((field) => {
          const error = validateField(field);
          setError(field, error);
          if (error && !firstInvalid) firstInvalid = field;
        });

        if (firstInvalid) {
          event.preventDefault();
          firstInvalid.focus();
        }
      });
    });
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  const catalogRoot = document.querySelector('.catalog-content');
  const catalogGrid = catalogRoot?.querySelector('.books-grid');
  const viewButtons = catalogRoot?.querySelectorAll('.view-btn[data-view]');

  if (!catalogRoot || !catalogGrid || !viewButtons || viewButtons.length === 0) {
    return;
  }

  const savedView = localStorage.getItem('catalogView') || 'grid';

  const applyCatalogView = (view) => {
    catalogGrid.classList.toggle('books-list-view', view === 'list');
    viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    localStorage.setItem('catalogView', view);
  };

  applyCatalogView(savedView);
  viewButtons.forEach((button) => button.addEventListener('click', () => applyCatalogView(button.dataset.view)));
});

// Toast notifications and shared micro-interactions
(() => {
  const hideToast = (toast) => {
    if (!toast || toast.classList.contains('is-hiding')) return;
    toast.classList.add('is-hiding');
    setTimeout(() => toast.remove(), 260);
  };

  const enhanceToast = (toast) => {
    toast.querySelector('.toast-close')?.addEventListener('click', () => hideToast(toast));
    setTimeout(() => hideToast(toast), 6000);
  };

  window.showToast = ({ type = 'success', title, message }) => {
    const region = document.getElementById('toast-region') || document.body.appendChild(Object.assign(document.createElement('div'), {
      className: 'toast-region',
      id: 'toast-region'
    }));
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    toast.dataset.toast = '';
    toast.innerHTML = `
      <i class="fas ${type === 'danger' ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i>
      <div class="toast-content"><strong>${title || (type === 'danger' ? 'Ошибка' : 'Готово')}</strong><span></span></div>
      <button type="button" class="toast-close" aria-label="Закрыть уведомление"><i class="fas fa-times"></i></button>
    `;
    toast.querySelector('.toast-content span').textContent = message || '';
    region.appendChild(toast);
    enhanceToast(toast);
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-toast]').forEach(enhanceToast);

    document.querySelectorAll('form').forEach((form) => {
      form.addEventListener('submit', (event) => {
        if (event.defaultPrevented) return;
        const submitter = event.submitter || form.querySelector('.btn[type="submit"], button[type="submit"]');
        submitter?.classList.add('is-loading');
        submitter?.setAttribute('aria-busy', 'true');
      });
    });

    window.addEventListener('pageshow', () => {
      document.querySelectorAll('.is-loading[aria-busy="true"]').forEach((button) => {
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
      });
    });

    document.querySelectorAll('.btn-success, [data-success-animation]').forEach((button) => {
      button.addEventListener('click', () => {
        button.classList.remove('success-pulse');
        void button.offsetWidth;
        button.classList.add('success-pulse');
      });
    });
  });
})();