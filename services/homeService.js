const { Op } = require('sequelize');
const { Book, ForumTopic, Review, User, UserBook } = require('../models');
const { getCoverUrl } = require('../utils/imageUrls');

const fallbackBook = {
  id: null,
  title: 'Мастер и Маргарита',
  author: 'Михаил Булгаков',
  coverUrl: '/images/covers/default-book-cover.jpg',
  reason: 'Культовый роман, который легко перечитывать и обсуждать: мистика, сатира и вечные вопросы о выборе.'
};

async function getBookOfDay() {
  const candidates = await Book.findAll({
    order: [['views_count', 'DESC'], ['ratings_count', 'DESC'], ['createdAt', 'DESC']],
    limit: 14
  });

  if (candidates.length === 0) return fallbackBook;

  const dayNumber = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const book = candidates[dayNumber % candidates.length];

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    coverUrl: getCoverUrl(book.cover_image, book.cover_public_id),
    reason: book.description
      ? `${book.description.slice(0, 170)}${book.description.length > 170 ? '...' : ''}`
      : 'Выбрали книгу за заметный интерес читателей и активность вокруг неё на платформе.'
  };
}

async function getDiscussedTopics() {
  const topics = await ForumTopic.findAll({
    where: { is_moderated: true },
    include: [{ model: User, as: 'user', attributes: ['name'] }],
    order: [['last_reply_at', 'DESC'], ['replies_count', 'DESC']],
    limit: 5
  });

  return topics.map((topic) => ({
    title: topic.title,
    url: `/forum/topic/${topic.slug}`,
    meta: `${topic.replies_count || 0} ответов · ${topic.user?.name || 'читатель'}`
  }));
}

async function getWeeklyTopReviews() {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const reviews = await Review.findAll({
    where: { is_moderated: true, createdAt: { [Op.gte]: weekAgo } },
    include: [
      { model: User, as: 'user', attributes: ['name'] },
      { model: Book, as: 'book', attributes: ['id', 'title', 'author'] }
    ],
    order: [['likes_count', 'DESC'], ['rating', 'DESC'], ['createdAt', 'DESC']],
    limit: 3
  });

  return reviews.map((review) => ({
    rating: review.rating,
    author: review.user?.name || 'читатель',
    bookTitle: review.book?.title || 'Книга',
    bookUrl: review.book ? `/books/${review.book.id}` : '/books',
    excerpt: `${review.content.slice(0, 135)}${review.content.length > 135 ? '...' : ''}`,
    likes: review.likes_count || 0
  }));
}

async function getCommunityActivity() {
  const activities = await UserBook.findAll({
    include: [
      { model: User, as: 'user', attributes: ['name'] },
      { model: Book, as: 'book', attributes: ['id', 'title'] }
    ],
    order: [['updatedAt', 'DESC']],
    limit: 5
  });

  const labels = {
    read: 'прочитал(а)',
    reading: 'читает сейчас',
    want_to_read: 'добавил(а) в планы'
  };

  return activities.map((activity) => ({
    userName: activity.user?.name || 'Читатель',
    action: labels[activity.status] || 'обновил(а) полку',
    bookTitle: activity.book?.title || 'книгу',
    bookUrl: activity.book ? `/books/${activity.book.id}` : '/books'
  }));
}

async function getPersonalBlock(userId) {
  if (!userId) return null;

  const [reading, wantToReadCount, readThisWeekCount] = await Promise.all([
    UserBook.findOne({
      where: { user_id: userId, status: 'reading' },
      include: [{ model: Book, as: 'book', attributes: ['id', 'title', 'author'] }],
      order: [['updatedAt', 'DESC']]
    }),
    UserBook.count({ where: { user_id: userId, status: 'want_to_read' } }),
    UserBook.count({
      where: {
        user_id: userId,
        status: 'read',
        updatedAt: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }
    })
  ]);

  return {
    continueReading: reading?.book ? { title: reading.book.title, author: reading.book.author, url: `/books/${reading.book.id}` } : null,
    weeklyGoal: `${readThisWeekCount}/2 книги на этой неделе`,
    shelfRecommendation: wantToReadCount > 0
      ? `На полке «Хочу прочитать» ждёт ${wantToReadCount} книг — выберите одну на вечер.`
      : 'Добавьте книги в «Хочу прочитать», и мы подскажем следующий шаг.'
  };
}

async function getHomePageData(userId) {
  const [bookOfDay, discussedTopics, weeklyTopReviews, communityActivity, personal] = await Promise.all([
    getBookOfDay().catch((error) => {
      console.error('Ошибка загрузки книги дня:', error);
      return fallbackBook;
    }),
    getDiscussedTopics().catch((error) => {
      console.error('Ошибка загрузки обсуждений для главной:', error);
      return [];
    }),
    getWeeklyTopReviews().catch((error) => {
      console.error('Ошибка загрузки топа рецензий для главной:', error);
      return [];
    }),
    getCommunityActivity().catch((error) => {
      console.error('Ошибка загрузки активности сообщества:', error);
      return [];
    }),
    getPersonalBlock(userId).catch((error) => {
      console.error('Ошибка загрузки персонального блока главной:', error);
      return null;
    })
  ]);

  return { bookOfDay, discussedTopics, weeklyTopReviews, communityActivity, personal };
}

module.exports = { getHomePageData, getCommunityActivity };