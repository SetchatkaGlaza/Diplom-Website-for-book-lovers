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
