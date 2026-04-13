// scripts/fix-images.js
const fs = require('fs');
const path = require('path');

const files = [
  'views/books/catalog.ejs',
  'views/books/show.ejs',
  'views/index.ejs',
  'views/profile/books.ejs',
  'views/profile/index.ejs',
  'views/partials/header.ejs',
  'views/forum/topic.ejs',
  'views/forum/index.ejs',
  'views/forum/category.ejs',
  'views/profile/public.ejs',
  'views/admin/books/index.ejs',
  'views/admin/users/index.ejs'
];

console.log('🔧 НАЧИНАЕМ ИСПРАВЛЕНИЕ ИЗОБРАЖЕНИЙ...\n');

files.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`❌ Файл не найден: ${file}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  let changes = 0;
  
  // 1. Заменяем img с обложками книг - СОХРАНЯЕМ ВСЕ АТРИБУТЫ
  const coverRegex = /<img([^>]*)src=["']\/images\/covers\/([^"']+)["']([^>]*)>/g;
  content = content.replace(coverRegex, (match, beforeSrc, filename, afterSrc) => {
    changes++;
    
    // Извлекаем существующие классы
    const classMatch = match.match(/class=["']([^"']*)["']/);
    const existingClasses = classMatch ? classMatch[1] : '';
    
    // Извлекаем alt текст
    const altMatch = match.match(/alt=["']([^"']*)["']/);
    const alt = altMatch ? altMatch[1] : 'Обложка книги';
    
    // Извлекаем остальные атрибуты (кроме src, class, alt)
    const otherAttrs = match
      .replace(/src=["'][^"']*["']/g, '')
      .replace(/class=["'][^"']*["']/g, '')
      .replace(/alt=["'][^"']*["']/g, '')
      .replace(/<img|>/g, '')
      .trim();
    
    // Определяем тип изображения по контексту
    let width = '';
    let extraClass = '';
    
    if (file.includes('show.ejs') || match.includes('book-cover-large')) {
      // Большая обложка на странице книги
      width = '400';
      extraClass = 'book-cover-large';
    } else if (file.includes('catalog.ejs') || match.includes('book-card')) {
      // Обложка в каталоге
      width = '200';
      extraClass = 'book-cover';
    } else {
      // Обычная обложка
      width = '150';
    }
    
    // Формируем новый тег с сохранением всех оригинальных классов
    const newClasses = `${existingClasses} lazy ${extraClass}`.trim();
    
    return `<img 
  src="/images/covers/${filename.replace(/\.\w+$/, '-thumb.jpg')}" 
  data-src="/images/covers/${filename}" 
  alt="${alt}" 
  class="${newClasses}"
  loading="lazy"
  width="${width}"
  ${otherAttrs}
  onerror="this.src='/images/covers/default-book-cover.jpg'; this.classList.add('error');"
>`;
  });
  
  // 2. Заменяем аватарки - СОХРАНЯЕМ ВСЕ АТРИБУТЫ
  const avatarRegex = /<img([^>]*)src=["']\/images\/avatars\/([^"']+)["']([^>]*)>/g;
  content = content.replace(avatarRegex, (match, beforeSrc, filename, afterSrc) => {
    changes++;
    
    // Извлекаем существующие классы
    const classMatch = match.match(/class=["']([^"']*)["']/);
    const existingClasses = classMatch ? classMatch[1] : '';
    
    // Извлекаем alt текст
    const altMatch = match.match(/alt=["']([^"']*)["']/);
    const alt = altMatch ? altMatch[1] : 'Аватар';
    
    // Извлекаем остальные атрибуты
    const otherAttrs = match
      .replace(/src=["'][^"']*["']/g, '')
      .replace(/class=["'][^"']*["']/g, '')
      .replace(/alt=["'][^"']*["']/g, '')
      .replace(/<img|>/g, '')
      .trim();
    
    // Определяем размер аватарки по классу
    let size = '40';
    if (existingClasses.includes('post-avatar')) size = '80';
    if (existingClasses.includes('topic-avatar')) size = '60';
    if (existingClasses.includes('nav-avatar')) size = '32';
    if (existingClasses.includes('reviewer-avatar')) size = '40';
    
    const newClasses = `${existingClasses} lazy`.trim();
    
    return `<img 
  src="/images/avatars/${filename}" 
  data-src="/images/avatars/${filename}" 
  alt="${alt}" 
  class="${newClasses}"
  loading="lazy"
  width="${size}"
  height="${size}"
  ${otherAttrs}
  onerror="this.src='/images/avatars/default-avatar.png';"
>`;
  });
  
  // 3. Добавляем CSS для ленивой загрузки, если его нет
  if (!content.includes('lazy-loading-styles')) {
    const styles = `

<!-- lazy-loading-styles -->
<style>
  .lazy {
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
    background: #f5f5f5;
  }
  .lazy.loaded {
    opacity: 1;
  }
  .lazy.error {
    opacity: 1;
  }
  /* Сохраняем оригинальные стили для разных типов изображений */
  .book-cover {
    width: 100%;
    height: auto;
    object-fit: cover;
    border-radius: 8px;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  }
  .book-cover-large {
    width: 100%;
    height: auto;
    object-fit: cover;
    border-radius: 12px;
    box-shadow: 0 8px 16px rgba(0,0,0,0.2);
  }
  .nav-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
  }
  .post-avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid #fbbf24;
  }
  .topic-avatar {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    object-fit: cover;
  }
  .reviewer-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
  }
  .table-cover {
    width: 40px;
    height: 60px;
    object-fit: cover;
    border-radius: 4px;
  }
  .table-avatar {
    width: 35px;
    height: 35px;
    border-radius: 50%;
    object-fit: cover;
  }
</style>
`;
    content += styles;
  }
  
  // 4. Добавляем скрипт ленивой загрузки, если его нет
  if (!content.includes('lazy-loading-script')) {
    const script = `

<!-- lazy-loading-script -->
<script>
(function() {
  // Функция для ленивой загрузки
  function lazyLoad() {
    const lazyImages = document.querySelectorAll('img.lazy:not(.loaded)');
    
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
              img.src = img.dataset.src;
              img.classList.add('loaded');
            }
            imageObserver.unobserve(img);
          }
        });
      }, {
        rootMargin: '50px 0px',
        threshold: 0.01
      });

      lazyImages.forEach(img => imageObserver.observe(img));
    } else {
      // Fallback для старых браузеров
      let lazyLoadThrottleTimeout;
      
      function lazyLoadCallback() {
        if (lazyLoadThrottleTimeout) {
          clearTimeout(lazyLoadThrottleTimeout);
        }
        
        lazyLoadThrottleTimeout = setTimeout(() => {
          const scrollTop = window.pageYOffset;
          lazyImages.forEach(img => {
            if (img.offsetTop < window.innerHeight + scrollTop) {
              if (img.dataset.src) {
                img.src = img.dataset.src;
                img.classList.add('loaded');
              }
            }
          });
        }, 20);
      }
      
      document.addEventListener('scroll', lazyLoadCallback);
      window.addEventListener('resize', lazyLoadCallback);
      window.addEventListener('orientationchange', lazyLoadCallback);
      lazyLoadCallback();
    }
  }
  
  // Запускаем после загрузки DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lazyLoad);
  } else {
    lazyLoad();
  }
  
  // Обработка ошибок загрузки
  document.addEventListener('error', function(e) {
    const img = e.target;
    if (img.tagName === 'IMG' && !img.src.includes('default')) {
      console.log('Ошибка загрузки изображения:', img.src);
      if (img.src.includes('/avatars/')) {
        img.src = '/images/avatars/default-avatar.png';
      } else if (img.src.includes('/covers/')) {
        img.src = '/images/covers/default-book-cover.jpg';
      }
      img.classList.add('error');
    }
  }, true);
})();
</script>
`;
    content += script;
  }
  
  fs.writeFileSync(filePath, content);
  console.log(`✅ ${file}: обновлено ${changes} изображений`);
});

console.log('\n🎉 ГОТОВО! Все изображения обновлены с сохранением стилей.');
console.log('📌 Проверь страницы:');
console.log('   - http://localhost:3000/books');
console.log('   - http://localhost:3000/books/1');
console.log('   - http://localhost:3000/forum');
console.log('   - http://localhost:3000/profile');