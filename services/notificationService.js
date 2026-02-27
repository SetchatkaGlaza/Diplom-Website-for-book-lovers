const { Notification, User, UserBook, Review, Book } = require('../models');

class NotificationService {
  
  /**
   * Создать уведомление для пользователя
   */
  async create(userId, type, title, message, link = null, data = null) {
    try {
      console.log(`📨 Создание уведомления для пользователя ${userId}: ${title}`);
      
      const notification = await Notification.create({
        user_id: userId,
        type,
        title,
        message,
        link,
        data,
        is_read: false
      });
      
      console.log(`✅ Уведомление создано, ID: ${notification.id}`);
      return notification;
    } catch (error) {
      console.error('❌ Ошибка при создании уведомления:', error);
      return null;
    }
  }
  
  /**
   * Получить уведомления пользователя
   */
  async getUserNotifications(userId, limit = 20, offset = 0) {
    try {
      const { count, rows } = await Notification.findAndCountAll({
        where: { user_id: userId },
        order: [['createdAt', 'DESC']],
        limit,
        offset
      });
      
      return {
        total: count,
        unread: await this.getUnreadCount(userId),
        notifications: rows
      };
    } catch (error) {
      console.error('❌ Ошибка при получении уведомлений:', error);
      return { total: 0, unread: 0, notifications: [] };
    }
  }
  
  /**
   * Получить количество непрочитанных уведомлений
   */
  async getUnreadCount(userId) {
    try {
      return await Notification.count({
        where: {
          user_id: userId,
          is_read: false
        }
      });
    } catch (error) {
      console.error('❌ Ошибка при подсчёте уведомлений:', error);
      return 0;
    }
  }
  
  /**
   * Отметить уведомление как прочитанное
   */
  async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOne({
        where: {
          id: notificationId,
          user_id: userId
        }
      });
      
      if (notification) {
        await notification.update({ is_read: true });
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Ошибка при отметке уведомления:', error);
      return false;
    }
  }
  
  /**
   * Отметить все уведомления как прочитанные
   */
  async markAllAsRead(userId) {
    try {
      await Notification.update(
        { is_read: true },
        {
          where: {
            user_id: userId,
            is_read: false
          }
        }
      );
      return true;
    } catch (error) {
      console.error('❌ Ошибка при отметке всех уведомлений:', error);
      return false;
    }
  }
  
  // ===== УВЕДОМЛЕНИЯ ДЛЯ РАЗНЫХ СОБЫТИЙ =====
  
  /**
   * Приветственное уведомление после регистрации
   */
  async welcomeNewUser(userId, userName) {
    return this.create(
      userId,
      'welcome',
      '🎉 Добро пожаловать в Книгоманы!',
      `${userName}, спасибо за регистрацию! Здесь вы найдёте множество книг и сможете делиться впечатлениями.`,
      '/books',
      { welcome: true }
    );
  }
  
  /**
   * Уведомление о модерации рецензии
   */
  async reviewModerated(reviewId, approved) {
    try {
      const review = await Review.findByPk(reviewId, {
        include: [{ model: Book, as: 'book' }]
      });
      
      if (!review) {
        console.error('❌ Рецензия не найдена:', reviewId);
        return;
      }
      
      const title = approved ? '✅ Рецензия одобрена' : '❌ Рецензия отклонена';
      const message = approved 
        ? `Ваша рецензия на книгу "${review.book?.title || 'книгу'}" прошла модерацию и опубликована.`
        : `Ваша рецензия на книгу "${review.book?.title || 'книгу'}" не прошла модерацию. Пожалуйста, ознакомьтесь с правилами.`;
      
      await this.create(
        review.user_id,
        'review_moderated',
        title,
        message,
        `/books/${review.book_id}`,
        { review_id: review.id, book_id: review.book_id, approved }
      );
      
      console.log(`✅ Уведомление о модерации отправлено пользователю ${review.user_id}`);
    } catch (error) {
      console.error('❌ Ошибка при создании уведомления о модерации:', error);
    }
  }
  
  /**
   * Уведомление о новой рецензии на книгу
   */
  async newReviewOnBook(bookId, reviewId) {
    try {
      const book = await Book.findByPk(bookId);
      const review = await Review.findByPk(reviewId, {
        include: [{ model: User, as: 'user' }]
      });
      
      if (!book || !review) {
        console.error('❌ Книга или рецензия не найдены');
        return;
      }
      
      // Находим пользователей, которые добавили эту книгу в "прочитано"
      const userBooks = await UserBook.findAll({
        where: {
          book_id: bookId,
          status: 'read'
        }
      });
      
      for (const userBook of userBooks) {
        // Не уведомляем автора рецензии
        if (userBook.user_id === review.user_id) continue;
        
        await this.create(
          userBook.user_id,
          'new_review',
          '📝 Новая рецензия',
          `На книгу "${book.title}", которую вы прочитали, появилась новая рецензия от ${review.user?.name || 'пользователя'}.`,
          `/books/${bookId}`,
          { book_id: bookId, review_id: reviewId, reviewer: review.user?.name }
        );
        
        console.log(`✅ Уведомление о новой рецензии отправлено пользователю ${userBook.user_id}`);
      }
    } catch (error) {
      console.error('❌ Ошибка при создании уведомления о новой рецензии:', error);
    }
  }
  
  /**
   * Уведомление о лайке на рецензию
   */
  async reviewLiked(reviewId, likerId, likeType) {
    try {
      const review = await Review.findByPk(reviewId, {
        include: [{ model: User, as: 'user' }, { model: Book, as: 'book' }]
      });
      
      const liker = await User.findByPk(likerId);
      
      if (!review || !liker) {
        console.error('❌ Рецензия или пользователь не найдены');
        return;
      }
      
      // Не уведомляем, если лайк поставил сам автор
      if (review.user_id === likerId) {
        console.log('⏭️ Автор лайкнул свою рецензию - уведомление не нужно');
        return;
      }
      
      const title = likeType === 'like' ? '👍 Лайк на рецензию' : '👎 Дизлайк на рецензию';
      const message = likeType === 'like'
        ? `Пользователю ${liker.name} понравилась ваша рецензия на книгу "${review.book?.title || 'книгу'}".`
        : `Пользователь ${liker.name} поставил дизлайк на вашу рецензию на книгу "${review.book?.title || 'книгу'}".`;
      
      await this.create(
        review.user_id,
        'review_liked',
        title,
        message,
        `/books/${review.book_id}`,
        { review_id: review.id, book_id: review.book_id, liker: liker.name, type: likeType }
      );
      
      console.log(`✅ Уведомление о ${likeType} отправлено автору рецензии ${review.user_id}`);
    } catch (error) {
      console.error('❌ Ошибка при создании уведомления о лайке:', error);
    }
  }
  
  /**
   * Уведомление о завершении импорта книг
   */
  async booksImported(adminId, stats) {
    try {
      const title = stats.success > 0 ? '📚 Импорт книг завершён' : '❌ Ошибка импорта';
      const message = stats.success > 0
        ? `Успешно импортировано ${stats.success} книг. ${stats.errors} ошибок, ${stats.skipped} пропущено.`
        : `Не удалось импортировать книги. Проверьте файл и попробуйте снова.`;
      
      await this.create(
        adminId,
        'book_imported',
        title,
        message,
        '/admin/books',
        stats
      );
      
      console.log(`✅ Уведомление об импорте отправлено администратору ${adminId}`);
    } catch (error) {
      console.error('❌ Ошибка при создании уведомления об импорте:', error);
    }
  }
}

module.exports = new NotificationService();