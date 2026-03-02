// controllers/forumModerationController.js
const { 
  ForumCategory, 
  ForumTopic, 
  ForumPost,
  User 
} = require('../models');
const { Op } = require('sequelize');
const notificationService = require('../services/notificationService');

/**
 * СПИСОК НА МОДЕРАЦИЮ
 */
exports.getModerationQueue = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    
    // Ожидающие модерации темы
    const { count: topicsCount, rows: pendingTopics } = await ForumTopic.findAndCountAll({
      where: { is_moderated: false },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email', 'avatar'] },
        { model: ForumCategory, as: 'category', attributes: ['id', 'name'] }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });
    
    // Ожидающие модерации сообщения
    const pendingPosts = await ForumPost.findAll({
      where: { is_moderated: false },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
        { 
          model: ForumTopic, 
          as: 'topic',
          include: [
            { model: ForumCategory, as: 'category', attributes: ['id', 'name'] },
            { model: User, as: 'user', attributes: ['id', 'name'] }
          ]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    
    // Получаем статистику
    const stats = {
      topicsPending: await ForumTopic.count({ where: { is_moderated: false } }),
      postsPending: await ForumPost.count({ where: { is_moderated: false } })
    };
    
    res.render('admin/forum-moderation', {
      title: 'Модерация форума',
      pendingTopics,
      pendingPosts,
      stats,
      currentPage: page,
      totalPages: Math.ceil(topicsCount / limit),
      totalTopics: topicsCount,
      user: req.session.user,
      layout: 'layouts/admin',
      path: '/admin/forum/moderation'
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке модерации:', error);
    req.flash('error', 'Произошла ошибка при загрузке модерации');
    res.redirect('/admin');
  }
};

/**
 * ОДОБРИТЬ ТЕМУ
 */
exports.approveTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    
    const topic = await ForumTopic.findByPk(topicId, {
      include: [
        { model: User, as: 'user' },
        { model: ForumPost, as: 'posts' }
      ]
    });
    
    if (!topic) {
      req.flash('error', 'Тема не найдена');
      return res.redirect('/admin/forum/moderation');
    }
    
    // Одобряем тему
    await topic.update({ is_moderated: true });
    
    // Одобряем все сообщения в теме
    await ForumPost.update(
      { is_moderated: true },
      { where: { topic_id: topicId } }
    );
    
    // Уведомляем автора
    await notificationService.forumTopicModerated(topic.user_id, topic, true);
    
    req.flash('success', `Тема "${topic.title}" одобрена`);
    res.redirect('/admin/forum/moderation');
    
  } catch (error) {
    console.error('Ошибка при одобрении темы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/forum/moderation');
  }
};

/**
 * ОТКЛОНИТЬ ТЕМУ
 */
exports.rejectTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const { reason } = req.body;
    
    if (!reason) {
      req.flash('error', 'Укажите причину отклонения');
      return res.redirect('/admin/forum/moderation');
    }
    
    const topic = await ForumTopic.findByPk(topicId, {
      include: [{ model: User, as: 'user' }]
    });
    
    if (!topic) {
      req.flash('error', 'Тема не найдена');
      return res.redirect('/admin/forum/moderation');
    }
    
    // Уведомляем автора
    await notificationService.forumTopicModerated(topic.user_id, topic, false, reason);
    
    // Удаляем тему и все сообщения
    await topic.destroy();
    
    req.flash('success', 'Тема отклонена и удалена');
    res.redirect('/admin/forum/moderation');
    
  } catch (error) {
    console.error('Ошибка при отклонении темы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/forum/moderation');
  }
};

/**
 * ЗАКРЫТЬ/ОТКРЫТЬ ТЕМУ
 */
exports.toggleTopicLock = async (req, res) => {
  try {
    const topicId = req.params.id;
    
    const topic = await ForumTopic.findByPk(topicId);
    
    if (!topic) {
      req.flash('error', 'Тема не найдена');
      return res.redirect('/admin/forum/moderation');
    }
    
    await topic.update({ is_locked: !topic.is_locked });
    
    req.flash('success', topic.is_locked ? 'Тема закрыта для ответов' : 'Тема открыта для ответов');
    res.redirect(`/forum/topic/${topicId}`);
    
  } catch (error) {
    console.error('Ошибка при изменении статуса темы:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/forum/moderation');
  }
};

/**
 * ЗАКРЕПИТЬ/ОТКРЕПИТЬ ТЕМУ
 */
exports.toggleTopicPin = async (req, res) => {
  try {
    const topicId = req.params.id;
    
    const topic = await ForumTopic.findByPk(topicId);
    
    if (!topic) {
      req.flash('error', 'Тема не найдена');
      return res.redirect('/admin/forum/moderation');
    }
    
    await topic.update({ is_pinned: !topic.is_pinned });
    
    req.flash('success', topic.is_pinned ? 'Тема закреплена вверху' : 'Тема откреплена');
    res.redirect(`/forum/category/${topic.category_id}`);
    
  } catch (error) {
    console.error('Ошибка при изменении закрепления:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/forum/moderation');
  }
};

/**
 * УПРАВЛЕНИЕ КАТЕГОРИЯМИ - СПИСОК
 */
exports.getCategories = async (req, res) => {
  try {
    const categories = await ForumCategory.findAll({
      include: [
        {
          model: ForumTopic,
          as: 'topics',
          attributes: ['id'],
          required: false
        }
      ],
      order: [['sort_order', 'ASC'], ['name', 'ASC']]
    });
    
    res.render('admin/forum-categories', {
      title: 'Управление категориями форума',
      categories,
      user: req.session.user,
      layout: 'layouts/admin',
      path: '/admin/forum/categories'
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке категорий:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin');
  }
};

/**
 * СОЗДАТЬ КАТЕГОРИЮ
 */
exports.createCategory = async (req, res) => {
  try {
    const { name, description, icon, sort_order } = req.body;
    
    if (!name || name.length < 3) {
      req.flash('error', 'Название должно содержать минимум 3 символа');
      return res.redirect('/admin/forum/categories');
    }
    
    await ForumCategory.create({
      name,
      description: description || null,
      icon: icon || 'fa-comments',
      sort_order: parseInt(sort_order) || 0,
      created_by: req.session.user.id,
      is_active: true
    });
    
    req.flash('success', 'Категория создана');
    res.redirect('/admin/forum/categories');
    
  } catch (error) {
    console.error('Ошибка при создании категории:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/forum/categories');
  }
};

/**
 * РЕДАКТИРОВАТЬ КАТЕГОРИЮ
 */
exports.updateCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const { name, description, icon, sort_order, is_active } = req.body;
    
    const category = await ForumCategory.findByPk(categoryId);
    
    if (!category) {
      req.flash('error', 'Категория не найдена');
      return res.redirect('/admin/forum/categories');
    }
    
    await category.update({
      name,
      description,
      icon,
      sort_order: parseInt(sort_order),
      is_active: is_active === 'on'
    });
    
    req.flash('success', 'Категория обновлена');
    res.redirect('/admin/forum/categories');
    
  } catch (error) {
    console.error('Ошибка при обновлении категории:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/forum/categories');
  }
};

/**
 * УДАЛИТЬ КАТЕГОРИЮ
 */
exports.deleteCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    
    // Проверяем, есть ли темы в категории
    const topicsCount = await ForumTopic.count({ where: { category_id: categoryId } });
    
    if (topicsCount > 0) {
      req.flash('error', 'Нельзя удалить категорию, в которой есть темы');
      return res.redirect('/admin/forum/categories');
    }
    
    await ForumCategory.destroy({ where: { id: categoryId } });
    
    req.flash('success', 'Категория удалена');
    res.redirect('/admin/forum/categories');
    
  } catch (error) {
    console.error('Ошибка при удалении категории:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/admin/forum/categories');
  }
};