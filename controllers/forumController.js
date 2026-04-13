// controllers/forumController.js
const { 
  ForumCategory, 
  ForumTopic, 
  ForumPost, 
  ForumPostLike, 
  ForumSubscription,
  User 
} = require('../models');
const { Op } = require('sequelize');
const slugify = require('slugify');
const notificationService = require('../services/notificationService');

/**
 * ГЛАВНАЯ ФОРУМА - список категорий
 */
exports.getIndex = async (req, res) => {
  try {
    const categories = await ForumCategory.findAll({
      where: { is_active: true },
      include: [
        {
          model: ForumTopic,
          as: 'topics',
          where: { is_moderated: true },
          required: false,
          limit: 5,
          order: [['last_reply_at', 'DESC']],
          include: [
            { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
            { model: User, as: 'lastReplyUser', attributes: ['id', 'name'] }
          ]
        }
      ],
      order: [['sort_order', 'ASC'], ['name', 'ASC']]
    });
    
    // Статистика для каждой категории
    const categoriesWithStats = await Promise.all(
      categories.map(async (category) => {
        const topicsCount = await ForumTopic.count({
          where: { 
            category_id: category.id,
            is_moderated: true 
          }
        });
        
        const postsCount = await ForumPost.count({
          include: [{
            model: ForumTopic,
            as: 'topic',
            where: { 
              category_id: category.id,
              is_moderated: true 
            }
          }]
        });
        
        return {
          ...category.toJSON(),
          topicsCount,
          postsCount
        };
      })
    );
    
    // Активные темы (за последние 24 часа)
    const activeTopics = await ForumTopic.findAll({
      where: {
        is_moderated: true,
        last_reply_at: {
          [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
        { 
          model: ForumPost, 
          as: 'posts',
          limit: 1,
          order: [['createdAt', 'DESC']],
          include: [{ model: User, as: 'user', attributes: ['id', 'name'] }]
        }
      ],
      order: [['last_reply_at', 'DESC']],
      limit: 10
    });
    
    res.render('forum/index', {
      title: 'Форум',
      categories: categoriesWithStats,
      activeTopics,
      user: req.session.user || null,
      layout: 'layouts/main'
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке форума:', error);
    req.flash('error', 'Произошла ошибка при загрузке форума');
    res.redirect('/');
  }
};

/**
 * ПРОСМОТР КАТЕГОРИИ
 */
exports.getCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    
    const category = await ForumCategory.findByPk(categoryId);
    
    if (!category) {
      req.flash('error', 'Категория не найдена');
      return res.redirect('/forum');
    }
    
    // Закреплённые темы
    const pinnedTopics = await ForumTopic.findAll({
      where: {
        category_id: categoryId,
        is_pinned: true,
        is_moderated: true
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
        { model: User, as: 'lastReplyUser', attributes: ['id', 'name'] }
      ],
      order: [['last_reply_at', 'DESC']]
    });
    
    // Обычные темы с пагинацией
    const { count, rows: topics } = await ForumTopic.findAndCountAll({
      where: {
        category_id: categoryId,
        is_pinned: false,
        is_moderated: true
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
        { model: User, as: 'lastReplyUser', attributes: ['id', 'name'] },
        {
          model: ForumPost,
          as: 'posts',
          attributes: ['id'],
          limit: 1,
          order: [['createdAt', 'DESC']]
        }
      ],
      order: [['last_reply_at', 'DESC']],
      limit,
      offset
    });
    
    res.render('forum/category', {
      title: category.name,
      category,
      pinnedTopics,
      topics,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalTopics: count,
      user: req.session.user || null,
      layout: 'layouts/main'
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке категории:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/forum');
  }
};

/**
 * ПРОСМОТР ТЕМЫ
 */
exports.getTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const offset = (page - 1) * limit;
    
    const topic = await ForumTopic.findOne({
      where: { 
        id: topicId,
        is_moderated: true 
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'avatar', 'role'] },
        { model: ForumCategory, as: 'category', attributes: ['id', 'name'] }
      ]
    });
    
    if (!topic) {
      req.flash('error', 'Тема не найдена или находится на модерации');
      return res.redirect('/forum');
    }
    
    // Увеличиваем счётчик просмотров
    await topic.increment('views');
    
    // Получаем сообщения с пагинацией
    const { count, rows: posts } = await ForumPost.findAndCountAll({
      where: { 
        topic_id: topicId,
        is_moderated: true 
      },
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id', 'name', 'avatar', 'role', 'createdAt'] 
        },
        {
          model: ForumPostLike,
          as: 'likes',
          attributes: ['user_id']
        }
      ],
      order: [['createdAt', 'ASC']],
      limit,
      offset
    });
    
    // Проверяем, подписан ли пользователь на тему
    let isSubscribed = false;
    let userLikes = new Set();
    
    if (req.session.user) {
      const subscription = await ForumSubscription.findOne({
        where: {
          topic_id: topicId,
          user_id: req.session.user.id
        }
      });
      isSubscribed = !!subscription;
      
      // Собираем лайки пользователя
      posts.forEach(post => {
        const userLiked = post.likes.some(like => like.user_id === req.session.user.id);
        if (userLiked) {
          userLikes.add(post.id);
        }
      });
    }
    
    res.render('forum/topic', {
      title: topic.title,
      topic,
      posts,
      userLikes: Array.from(userLikes),
      isSubscribed,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalPosts: count,
      user: req.session.user || null,
      layout: 'layouts/main'
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке темы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/forum');
  }
};

/**
 * СОЗДАНИЕ НОВОЙ ТЕМЫ (форма)
 */
exports.getNewTopic = async (req, res) => {
  try {
    const categories = await ForumCategory.findAll({
      where: { is_active: true },
      order: [['name', 'ASC']]
    });
    
    // Передаём пустой массив errors, даже если ошибок нет
    res.render('forum/new-topic', {
      title: 'Создать тему',
      categories,
      errors: [],                    // <-- ВАЖНО: добавляем пустой массив
      formData: null,                 // <-- добавляем formData
      user: req.session.user,
      layout: 'layouts/main'
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке формы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/forum');
  }
};
/**
 * СОЗДАНИЕ НОВОЙ ТЕМЫ (обработка)
 */
exports.postNewTopic = async (req, res) => {
  try {
    const { category_id, title, content } = req.body;
    const userId = req.session.user.id;
    
    // Валидация
    const errors = [];
    
    if (!category_id) {
      errors.push({ msg: 'Выберите категорию' });
    }
    
    if (!title || title.length < 5) {
      errors.push({ msg: 'Заголовок должен содержать минимум 5 символов' });
    }
    
    if (!content || content.length < 10) {
      errors.push({ msg: 'Сообщение должно содержать минимум 10 символов' });
    }
    
    if (errors.length > 0) {
      const categories = await ForumCategory.findAll({
        where: { is_active: true },
        order: [['name', 'ASC']]
      });
      
      // ВАЖНО: передаём errors и formData обратно в шаблон
      return res.render('forum/new-topic', {
        title: 'Создать тему',
        categories,
        errors,                       // <-- передаём ошибки
        formData: { category_id, title, content }, // <-- передаём введённые данные
        user: req.session.user,
        layout: 'layouts/main'
      });
    }
    
    // Создаём slug для URL
    const slug = require('slugify')(title, { lower: true, strict: true }) + '-' + Date.now();
    
    // Создаём тему
    const topic = await ForumTopic.create({
      category_id,
      user_id: userId,
      title,
      slug,
      content,
      last_reply_user_id: userId,
      is_moderated: false
    });
    
    // Создаём первое сообщение
    await ForumPost.create({
      topic_id: topic.id,
      user_id: userId,
      content,
      is_moderated: false,
      ip_address: req.ip
    });
    
    req.flash('success', 'Тема создана и отправлена на модерацию');
    res.redirect('/forum');
    
  } catch (error) {
    console.error('Ошибка при создании темы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/forum/new');
  }
};

/**
 * ОТВЕТ В ТЕМЕ
 */
exports.postReply = async (req, res) => {
  try {
    const topicId = req.params.id;
    let { content } = req.body;
    const userId = req.session.user.id;
    
    const topic = await ForumTopic.findByPk(topicId);
    
    if (!topic) {
      req.flash('error', 'Тема не найдена');
      return res.redirect('/forum');
    }
    
    if (topic.is_locked) {
      req.flash('error', 'Тема закрыта для ответов');
      return res.redirect(`/forum/topic/${topicId}`);
    }
    
    if (!content || content.trim().length < 2) {
      req.flash('error', 'Сообщение не может быть пустым');
      return res.redirect(`/forum/topic/${topicId}`);
    }
    
    // Сохраняем как есть, с переносами строк
    // Не заменяем \n на <br> - это сделаем только при отображении
    content = content.trim();
    
    const post = await ForumPost.create({
      topic_id: topicId,
      user_id: userId,
      content: content,  // Сохраняем с \n
      is_moderated: true,
      ip_address: req.ip
    });
    
    await topic.update({
      last_reply_at: new Date(),
      last_reply_user_id: userId,
      replies_count: topic.replies_count + 1
    });
    
    const subscribers = await ForumSubscription.findAll({
      where: { topic_id: topicId },
      include: [{ model: User, as: 'user' }]
    });
    
    for (const sub of subscribers) {
      if (sub.user_id !== userId) {
        await notificationService.forumNewReply(
          sub.user_id,
          topic,
          post,
          req.session.user.name
        );
      }
    }
    
    req.flash('success', 'Ответ добавлен');
    res.redirect(`/forum/topic/${topicId}#post-${post.id}`);
    
  } catch (error) {
    console.error('Ошибка при ответе:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect(`/forum/topic/${req.params.id}`);
  }
};

/**
 * ЛАЙК СООБЩЕНИЯ - ИСПРАВЛЕННАЯ ВЕРСИЯ
 */
exports.likePost = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.session.user.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    // Получаем сообщение с текущим количеством лайков
    const post = await ForumPost.findByPk(postId);
    
    if (!post) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }
    
    // Проверяем, ставил ли пользователь уже лайк
    const existingLike = await ForumPostLike.findOne({
      where: { 
        post_id: postId, 
        user_id: userId 
      }
    });
    
    let newLikesCount;
    let action;
    
    if (existingLike) {
      // Если лайк уже есть - удаляем его
      await existingLike.destroy();
      newLikesCount = post.likes_count - 1;
      action = 'unliked';
      
      // Обновляем счётчик в посте
      await post.update({ likes_count: newLikesCount });
      
    } else {
      // Если лайка нет - создаём
      await ForumPostLike.create({ 
        post_id: postId, 
        user_id: userId 
      });
      
      newLikesCount = post.likes_count + 1;
      action = 'liked';
      
      // Обновляем счётчик в посте
      await post.update({ likes_count: newLikesCount });
      
      // Уведомляем автора поста о лайке (только если это не сам автор)
      if (post.user_id !== userId) {
        const topic = await ForumTopic.findByPk(post.topic_id);
        const liker = await User.findByPk(userId, { attributes: ['name'] });
        
        await notificationService.forumPostLiked(
          post.user_id,
          topic,
          post,
          liker.name
        );
      }
    }
    
    // Возвращаем актуальное количество лайков
    res.json({ 
      success: true, 
      action: action,
      likesCount: newLikesCount
    });
    
  } catch (error) {
    console.error('Ошибка при лайке:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
};

/**
 * ПОДПИСКА НА ТЕМУ
 */
exports.toggleSubscription = async (req, res) => {
  try {
    const topicId = req.params.id;
    const userId = req.session.user.id;
    
    const existingSub = await ForumSubscription.findOne({
      where: { topic_id: topicId, user_id: userId }
    });
    
    if (existingSub) {
      await existingSub.destroy();
      res.json({ success: true, action: 'unsubscribed' });
    } else {
      await ForumSubscription.create({ topic_id: topicId, user_id: userId });
      res.json({ success: true, action: 'subscribed' });
    }
    
  } catch (error) {
    console.error('Ошибка при подписке:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
};

/**
 * РЕДАКТИРОВАНИЕ СООБЩЕНИЯ (форма)
 */
exports.getEditPost = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.session.user.id;
    
    const post = await ForumPost.findOne({
      where: { id: postId },
      include: [{ model: ForumTopic, as: 'topic' }]
    });
    
    if (!post) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/forum');
    }
    
    // Проверяем права (автор или модератор/админ)
    const isAuthor = post.user_id === userId;
    const isModerator = req.session.user.role === 'moderator' || req.session.user.role === 'admin';
    
    if (!isAuthor && !isModerator) {
      req.flash('error', 'У вас нет прав для редактирования этого сообщения');
      return res.redirect(`/forum/topic/${post.topic_id}`);
    }
    
    res.render('forum/edit-post', {
      title: 'Редактирование сообщения',
      post,
      user: req.session.user,
      layout: 'layouts/main'
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке формы редактирования:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/forum');
  }
};

/**
 * РЕДАКТИРОВАНИЕ СООБЩЕНИЯ (обработка)
 */
exports.postEditPost = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.session.user.id;
    const { content } = req.body;
    
    const post = await ForumPost.findByPk(postId);
    
    if (!post) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/forum');
    }
    
    // Проверяем права
    const isAuthor = post.user_id === userId;
    const isModerator = req.session.user.role === 'moderator' || req.session.user.role === 'admin';
    
    if (!isAuthor && !isModerator) {
      req.flash('error', 'У вас нет прав для редактирования этого сообщения');
      return res.redirect(`/forum/topic/${post.topic_id}`);
    }
    
    // Валидация
    if (!content || content.length < 2) {
      req.flash('error', 'Сообщение не может быть пустым');
      return res.redirect(`/forum/post/${postId}/edit`);
    }
    
    await post.update({
      content,
      is_edited: true,
      edited_by: userId,
      edited_at: new Date()
    });
    
    req.flash('success', 'Сообщение обновлено');
    res.redirect(`/forum/topic/${post.topic_id}#post-${postId}`);
    
  } catch (error) {
    console.error('Ошибка при редактировании:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect(`/forum/post/${req.params.id}/edit`);
  }
};

/**
 * ПОИСК ПО ФОРУМУ
 */
exports.search = async (req, res) => {
  try {
    const query = req.query.q;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    
    if (!query || query.length < 3) {
      return res.render('forum/search', {
        title: 'Поиск по форуму',
        query,
        results: [],
        user: req.session.user || null,
        layout: 'layouts/main'
      });
    }
    
    // Ищем в темах
    const { count, rows: topics } = await ForumTopic.findAndCountAll({
      where: {
        [Op.or]: [
          { title: { [Op.iLike]: `%${query}%` } },
          { content: { [Op.iLike]: `%${query}%` } }
        ],
        is_moderated: true
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
        { model: ForumCategory, as: 'category', attributes: ['id', 'name'] }
      ],
      order: [['last_reply_at', 'DESC']],
      limit,
      offset
    });
    
    // Ищем в сообщениях
    const posts = await ForumPost.findAll({
      where: {
        content: { [Op.iLike]: `%${query}%` },
        is_moderated: true
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name'] },
        { 
          model: ForumTopic, 
          as: 'topic',
          include: [{ model: ForumCategory, as: 'category' }]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 10
    });
    
    res.render('forum/search', {
      title: 'Поиск по форуму',
      query,
      topics,
      posts,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalResults: count,
      user: req.session.user || null,
      layout: 'layouts/main'
    });
    
  } catch (error) {
    console.error('Ошибка при поиске:', error);
    req.flash('error', 'Произошла ошибка при поиске');
    res.redirect('/forum');
  }
};