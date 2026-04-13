const { ForumCategory, ForumTopic, ForumPost, User } = require('../models');
const { Op } = require('sequelize');
const notificationService = require('../services/notificationService');

const buildRedirectUrl = (basePath, query = {}) => {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, value);
    }
  });

  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
};

exports.getDashboard = async (req, res) => {
  try {
    const [
      totalCategories,
      activeCategories,
      totalTopics,
      moderatedTopics,
      pendingTopics,
      totalPosts,
      pendingPosts,
      lockedTopics,
      pinnedTopics,
      recentTopics,
      recentPosts
    ] = await Promise.all([
      ForumCategory.count(),
      ForumCategory.count({ where: { is_active: true } }),
      ForumTopic.count(),
      ForumTopic.count({ where: { is_moderated: true } }),
      ForumTopic.count({ where: { is_moderated: false } }),
      ForumPost.count(),
      ForumPost.count({ where: { is_moderated: false } }),
      ForumTopic.count({ where: { is_locked: true } }),
      ForumTopic.count({ where: { is_pinned: true } }),
      ForumTopic.findAll({
        include: [
          { model: User, as: 'user', attributes: ['id', 'name'] },
          { model: ForumCategory, as: 'category', attributes: ['id', 'name'] }
        ],
        order: [['createdAt', 'DESC']],
        limit: 5
      }),
      ForumPost.findAll({
        include: [
          { model: User, as: 'user', attributes: ['id', 'name'] },
          {
            model: ForumTopic,
            as: 'topic',
            attributes: ['id', 'title']
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: 5
      })
    ]);

    res.render('admin/forum-dashboard', {
      title: 'Форум — обзор',
      stats: {
        totalCategories,
        activeCategories,
        totalTopics,
        moderatedTopics,
        pendingTopics,
        totalPosts,
        pendingPosts,
        lockedTopics,
        pinnedTopics
      },
      recentTopics,
      recentPosts,
      user: req.session.user,
      layout: 'layouts/admin',
      path: '/admin/forum'
    });
  } catch (error) {
    console.error('Ошибка при загрузке обзорной страницы форума:', error);
    req.flash('error', 'Не удалось загрузить обзор форума');
    res.redirect('/admin');
  }
};

exports.getModerationQueue = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = 15;
    const offset = (page - 1) * limit;
    const tab = req.query.tab === 'posts' ? 'posts' : 'topics';
    const search = (req.query.q || '').trim();

    const topicWhere = { is_moderated: false };
    const postWhere = { is_moderated: false };

    if (search) {
      topicWhere[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { content: { [Op.iLike]: `%${search}%` } }
      ];
      postWhere.content = { [Op.iLike]: `%${search}%` };
    }

    const [{ count: topicsCount, rows: pendingTopics }, { count: postsCount, rows: pendingPosts }] = await Promise.all([
      ForumTopic.findAndCountAll({
        where: topicWhere,
        include: [
          { model: User, as: 'user', attributes: ['id', 'name', 'email', 'avatar'] },
          { model: ForumCategory, as: 'category', attributes: ['id', 'name'] }
        ],
        order: [['createdAt', 'DESC']],
        limit: tab === 'topics' ? limit : 5,
        offset: tab === 'topics' ? offset : 0
      }),
      ForumPost.findAndCountAll({
        where: postWhere,
        include: [
          { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
          {
            model: ForumTopic,
            as: 'topic',
            attributes: ['id', 'title', 'category_id'],
            include: [{ model: ForumCategory, as: 'category', attributes: ['id', 'name'] }]
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: tab === 'posts' ? limit : 10,
        offset: tab === 'posts' ? offset : 0
      })
    ]);

    res.render('admin/forum-moderation', {
      title: 'Форум — модерация',
      pendingTopics,
      pendingPosts,
      filters: { tab, search },
      stats: {
        topicsPending: topicsCount,
        postsPending: postsCount,
        totalPending: topicsCount + postsCount
      },
      currentPage: page,
      totalPages: Math.max(1, Math.ceil((tab === 'posts' ? postsCount : topicsCount) / limit)),
      user: req.session.user,
      layout: 'layouts/admin',
      path: '/admin/forum/moderation'
    });
  } catch (error) {
    console.error('Ошибка при загрузке модерации:', error);
    req.flash('error', 'Произошла ошибка при загрузке модерации');
    res.redirect('/admin/forum');
  }
};

exports.approveTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const topic = await ForumTopic.findByPk(topicId, {
      include: [{ model: User, as: 'user' }]
    });

    if (!topic) {
      req.flash('error', 'Тема не найдена');
      return res.redirect('/admin/forum/moderation');
    }

    await topic.update({ is_moderated: true });
    await ForumPost.update({ is_moderated: true }, { where: { topic_id: topicId } });

    await notificationService.forumTopicModerated(topic.user_id, topic, true);

    req.flash('success', `Тема «${topic.title}» одобрена`);
    res.redirect(buildRedirectUrl('/admin/forum/moderation', { tab: 'topics', page: req.query.page }));
  } catch (error) {
    console.error('Ошибка при одобрении темы:', error);
    req.flash('error', 'Не удалось одобрить тему');
    res.redirect('/admin/forum/moderation');
  }
};

exports.rejectTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const reason = (req.body.reason || '').trim();

    if (!reason) {
      req.flash('error', 'Укажите причину отклонения темы');
      return res.redirect('/admin/forum/moderation?tab=topics');
    }

    const topic = await ForumTopic.findByPk(topicId, {
      include: [{ model: User, as: 'user' }]
    });

    if (!topic) {
      req.flash('error', 'Тема не найдена');
      return res.redirect('/admin/forum/moderation?tab=topics');
    }

    await notificationService.forumTopicModerated(topic.user_id, topic, false, reason);
    await topic.destroy();

    req.flash('success', 'Тема отклонена и удалена');
    res.redirect('/admin/forum/moderation?tab=topics');
  } catch (error) {
    console.error('Ошибка при отклонении темы:', error);
    req.flash('error', 'Не удалось отклонить тему');
    res.redirect('/admin/forum/moderation?tab=topics');
  }
};

exports.approvePost = async (req, res) => {
  try {
    const postId = req.params.id;
    const post = await ForumPost.findByPk(postId, {
      include: [{ model: ForumTopic, as: 'topic' }]
    });

    if (!post) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/admin/forum/moderation?tab=posts');
    }

    await post.update({ is_moderated: true });

    req.flash('success', 'Сообщение одобрено');
    res.redirect('/admin/forum/moderation?tab=posts');
  } catch (error) {
    console.error('Ошибка при одобрении сообщения:', error);
    req.flash('error', 'Не удалось одобрить сообщение');
    res.redirect('/admin/forum/moderation?tab=posts');
  }
};

exports.rejectPost = async (req, res) => {
  try {
    const postId = req.params.id;
    const reason = (req.body.reason || '').trim();

    if (!reason) {
      req.flash('error', 'Укажите причину отклонения сообщения');
      return res.redirect('/admin/forum/moderation?tab=posts');
    }

    const post = await ForumPost.findByPk(postId, {
      include: [
        { model: User, as: 'user' },
        { model: ForumTopic, as: 'topic' }
      ]
    });

    if (!post) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/admin/forum/moderation?tab=posts');
    }

    await post.destroy();

    req.flash('success', 'Сообщение отклонено и удалено');
    res.redirect('/admin/forum/moderation?tab=posts');
  } catch (error) {
    console.error('Ошибка при отклонении сообщения:', error);
    req.flash('error', 'Не удалось отклонить сообщение');
    res.redirect('/admin/forum/moderation?tab=posts');
  }
};

exports.toggleTopicLock = async (req, res) => {
  try {
    const topicId = req.params.id;
    const topic = await ForumTopic.findByPk(topicId);

    if (!topic) {
      req.flash('error', 'Тема не найдена');
      return res.redirect('/admin/forum/moderation');
    }

    await topic.update({ is_locked: !topic.is_locked });
    req.flash('success', topic.is_locked ? 'Тема закрыта' : 'Тема открыта');
    res.redirect('/admin/forum/moderation?tab=topics');
  } catch (error) {
    console.error('Ошибка при изменении статуса темы:', error);
    req.flash('error', 'Не удалось изменить статус темы');
    res.redirect('/admin/forum/moderation?tab=topics');
  }
};

exports.toggleTopicPin = async (req, res) => {
  try {
    const topicId = req.params.id;
    const topic = await ForumTopic.findByPk(topicId);

    if (!topic) {
      req.flash('error', 'Тема не найдена');
      return res.redirect('/admin/forum/moderation');
    }

    await topic.update({ is_pinned: !topic.is_pinned });
    req.flash('success', topic.is_pinned ? 'Тема закреплена' : 'Тема откреплена');
    res.redirect('/admin/forum/moderation?tab=topics');
  } catch (error) {
    console.error('Ошибка при закреплении темы:', error);
    req.flash('error', 'Не удалось изменить закрепление темы');
    res.redirect('/admin/forum/moderation?tab=topics');
  }
};

exports.getCategories = async (req, res) => {
  try {
    const categories = await ForumCategory.findAll({
      include: [
        {
          model: ForumTopic,
          as: 'topics',
          attributes: ['id', 'is_moderated'],
          required: false
        }
      ],
      order: [['sort_order', 'ASC'], ['name', 'ASC']]
    });

    const mappedCategories = categories.map((category) => {
      const topics = category.topics || [];
      return {
        ...category.toJSON(),
        topicsCount: topics.length,
        moderatedTopicsCount: topics.filter((topic) => topic.is_moderated).length
      };
    });

    res.render('admin/forum-categories', {
      title: 'Форум — категории',
      categories: mappedCategories,
      user: req.session.user,
      layout: 'layouts/admin',
      path: '/admin/forum/categories'
    });
  } catch (error) {
    console.error('Ошибка при загрузке категорий:', error);
    req.flash('error', 'Не удалось загрузить категории форума');
    res.redirect('/admin/forum');
  }
};

exports.createCategory = async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();
    const icon = (req.body.icon || 'fa-comments').trim();
    const sortOrder = Number.parseInt(req.body.sort_order, 10) || 0;

    if (name.length < 3) {
      req.flash('error', 'Название должно содержать минимум 3 символа');
      return res.redirect('/admin/forum/categories');
    }

    const existing = await ForumCategory.findOne({ where: { name: { [Op.iLike]: name } } });
    if (existing) {
      req.flash('error', 'Категория с таким названием уже существует');
      return res.redirect('/admin/forum/categories');
    }

    await ForumCategory.create({
      name,
      description: description || null,
      icon: icon || 'fa-comments',
      sort_order: sortOrder,
      created_by: req.session.user.id,
      is_active: true
    });

    req.flash('success', 'Категория создана');
    res.redirect('/admin/forum/categories');
  } catch (error) {
    console.error('Ошибка при создании категории:', error);
    req.flash('error', 'Не удалось создать категорию');
    res.redirect('/admin/forum/categories');
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();
    const icon = (req.body.icon || 'fa-comments').trim();
    const sortOrder = Number.parseInt(req.body.sort_order, 10) || 0;

    if (name.length < 3) {
      req.flash('error', 'Название должно содержать минимум 3 символа');
      return res.redirect('/admin/forum/categories');
    }

    const category = await ForumCategory.findByPk(categoryId);
    if (!category) {
      req.flash('error', 'Категория не найдена');
      return res.redirect('/admin/forum/categories');
    }

    const duplicate = await ForumCategory.findOne({
      where: {
        id: { [Op.ne]: categoryId },
        name: { [Op.iLike]: name }
      }
    });

    if (duplicate) {
      req.flash('error', 'Категория с таким названием уже существует');
      return res.redirect('/admin/forum/categories');
    }

    await category.update({
      name,
      description: description || null,
      icon: icon || 'fa-comments',
      sort_order: sortOrder,
      is_active: req.body.is_active === 'on'
    });

    req.flash('success', 'Категория обновлена');
    res.redirect('/admin/forum/categories');
  } catch (error) {
    console.error('Ошибка при обновлении категории:', error);
    req.flash('error', 'Не удалось обновить категорию');
    res.redirect('/admin/forum/categories');
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
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
    req.flash('error', 'Не удалось удалить категорию');
    res.redirect('/admin/forum/categories');
  }
};
