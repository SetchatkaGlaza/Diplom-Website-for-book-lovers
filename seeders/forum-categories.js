// seeders/forum-categories.js
const { ForumCategory } = require('../models');

async function seedForumCategories() {
  try {
    console.log('🌱 Создание категорий форума...');
    
    const categories = [
      {
        name: 'Общие обсуждения',
        description: 'Здесь можно обсуждать любые темы, связанные с книгами и чтением',
        icon: 'fa-comments',
        sort_order: 1,
        created_by: 1, // ID администратора
        is_active: true
      },
      {
        name: 'Книжные рекомендации',
        description: 'Делитесь рекомендациями и ищите новые книги для чтения',
        icon: 'fa-bookmark',
        sort_order: 2,
        created_by: 1,
        is_active: true
      },
      {
        name: 'Рецензии и отзывы',
        description: 'Обсуждайте рецензии на книги, делитесь мнениями',
        icon: 'fa-star',
        sort_order: 3,
        created_by: 1,
        is_active: true
      },
      {
        name: 'Жанровые клубы',
        description: 'Фэнтези, детективы, классика, научная фантастика и другие жанры',
        icon: 'fa-tags',
        sort_order: 4,
        created_by: 1,
        is_active: true
      },
      {
        name: 'Помощь и поддержка',
        description: 'Вопросы по работе сайта, предложения и пожелания',
        icon: 'fa-life-ring',
        sort_order: 5,
        created_by: 1,
        is_active: true
      }
    ];
    
    for (const category of categories) {
      await ForumCategory.findOrCreate({
        where: { name: category.name },
        defaults: category
      });
    }
    
    console.log('✅ Категории форума созданы!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

seedForumCategories();