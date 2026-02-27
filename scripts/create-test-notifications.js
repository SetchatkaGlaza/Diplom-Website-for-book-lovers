const { User, Notification } = require('../models');

async function createTestNotifications() {
  try {
    console.log('🔄 Создание тестовых уведомлений...');
    
    // Находим первого пользователя (не админа)
    const user = await User.findOne({ where: { role: 'user' } });
    
    if (!user) {
      console.log('❌ Пользователь не найден');
      return;
    }
    
    // Создаём тестовые уведомления
    await Notification.bulkCreate([
      {
        user_id: user.id,
        type: 'review_moderated',
        title: '✅ Рецензия одобрена',
        message: 'Ваша рецензия на книгу "Война и мир" прошла модерацию и опубликована.',
        link: '/books/1',
        data: { book_id: 1, review_id: 1, approved: true },
        is_read: false
      },
      {
        user_id: user.id,
        type: 'new_review',
        title: '📝 Новая рецензия',
        message: 'На книгу "Преступление и наказание", которую вы прочитали, появилась новая рецензия.',
        link: '/books/2',
        data: { book_id: 2, review_id: 2 },
        is_read: true
      },
      {
        user_id: user.id,
        type: 'review_liked',
        title: '👍 Лайк на рецензию',
        message: 'Пользователю Ивану понравилась ваша рецензия.',
        link: '/books/3',
        data: { book_id: 3, review_id: 3, liker: 'Иван', type: 'like' },
        is_read: false
      },
      {
        user_id: user.id,
        type: 'system',
        title: '🎉 Добро пожаловать!',
        message: 'Спасибо за регистрацию на нашем сайте!',
        is_read: false
      }
    ]);
    
    console.log(`✅ Создано 4 тестовых уведомления для пользователя ${user.name}`);
    
  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    process.exit(0);
  }
}

createTestNotifications();