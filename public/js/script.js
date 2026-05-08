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
    let error = field.parentElement?.querySelector(`.field-error[data-for="${field.name || field.id}"]`);

    if (!error && message) {
      error = document.createElement('small');
      error.className = 'field-error';
      error.dataset.for = field.name || field.id;
      field.insertAdjacentElement('afterend', error);
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

    if (savedTheme === 'dark') {
      document.body.classList.add('theme-dark');
    }

    themeToggle?.addEventListener('click', () => {
      document.body.classList.toggle('theme-dark');
      const isDark = document.body.classList.contains('theme-dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      themeToggle.querySelector('i').className = isDark ? 'fas fa-sun' : 'fas fa-moon';
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
  const catalogGrid = document.querySelector('.books-grid');
  const viewButtons = document.querySelectorAll('.view-btn[data-view]');
  const savedView = localStorage.getItem('catalogView') || 'grid';

  const applyCatalogView = (view) => {
    if (!catalogGrid) return;
    catalogGrid.classList.toggle('books-list-view', view === 'list');
    viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    localStorage.setItem('catalogView', view);
  };

  applyCatalogView(savedView);
  viewButtons.forEach((button) => button.addEventListener('click', () => applyCatalogView(button.dataset.view)));
});
