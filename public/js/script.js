// Мобильное меню
document.addEventListener('DOMContentLoaded', function() {
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const navMenu = document.getElementById('nav-menu');
  
  if (mobileMenuBtn && navMenu) {
    mobileMenuBtn.addEventListener('click', function() {
      navMenu.classList.toggle('active');
      
      // Меняем иконку
      const icon = this.querySelector('i');
      if (navMenu.classList.contains('active')) {
        icon.className = 'fas fa-times';
      } else {
        icon.className = 'fas fa-bars';
      }
    });
    
    // Закрываем меню при клике на ссылку
    navMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
        const icon = mobileMenuBtn.querySelector('i');
        icon.className = 'fas fa-bars';
      });
    });
  }
  
  // Анимация чисел статистики
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
  
  // Плавная прокрутка
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
  
  // Подсветка активной ссылки в навигации
  const currentLocation = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link');
  
  navLinks.forEach(link => {
    if (link.getAttribute('href') === currentLocation) {
      link.classList.add('active');
    }
  });
});

// Анимация при скролле
window.addEventListener('scroll', function() {
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