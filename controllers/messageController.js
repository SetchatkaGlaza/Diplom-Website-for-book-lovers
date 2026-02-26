const { ContactMessage, User } = require('../models');
const { Op } = require('sequelize');
const { sendAdminNotification, sendReplyToUser } = require('../config/mail');

/**
 * 1. ПОЛУЧИТЬ ВСЕ СООБЩЕНИЯ (для админки)
 */
exports.getAllMessages = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const filter = req.query.filter || 'all';
    const search = req.query.search || '';

    let where = {};
    
    if (filter === 'unread') {
      where.is_read = false;
      where.is_archived = false;
    } else if (filter === 'replied') {
      where.is_replied = true;
    } else if (filter === 'archived') {
      where.is_archived = true;
    } else {
      where.is_archived = false;
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { message: { [Op.iLike]: `%${search}%` } },
        { subject: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: messages } = await ContactMessage.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'responder',
          attributes: ['id', 'name', 'avatar']
        }
      ],
      order: [
        ['is_read', 'ASC'],
        ['createdAt', 'DESC']
      ],
      limit,
      offset
    });

    const stats = {
      total: await ContactMessage.count({ where: { is_archived: false } }),
      unread: await ContactMessage.count({ where: { is_read: false, is_archived: false } }),
      replied: await ContactMessage.count({ where: { is_replied: true, is_archived: false } }),
      archived: await ContactMessage.count({ where: { is_archived: true } })
    };

    res.render('admin/messages/index', {
      title: 'Управление сообщениями',
      messages,
      stats,
      currentFilter: filter,
      search,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      totalMessages: count
      // УБИРАЕМ layout: 'layouts/admin' - он не нужен
    });

  } catch (error) {
    console.error('Ошибка при загрузке сообщений:', error);
    req.flash('error', 'Ошибка при загрузке сообщений');
    res.redirect('/admin');
  }
};

/**
 * 2. ПОЛУЧИТЬ ОДНО СООБЩЕНИЕ
 */
exports.getMessageById = async (req, res) => {
  try {
    const messageId = req.params.id;

    const message = await ContactMessage.findByPk(messageId, {
      include: [
        {
          model: User,
          as: 'responder',
          attributes: ['id', 'name', 'avatar']
        }
      ]
    });

    if (!message) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/admin/messages');
    }

    // Отмечаем как прочитанное
    if (!message.is_read) {
      await message.update({ is_read: true });
    }

    // Получаем предыдущее и следующее сообщение для навигации
    const prevMessage = await ContactMessage.findOne({
      where: {
        id: { [Op.lt]: messageId },
        is_archived: false
      },
      order: [['id', 'DESC']]
    });

    const nextMessage = await ContactMessage.findOne({
      where: {
        id: { [Op.gt]: messageId },
        is_archived: false
      },
      order: [['id', 'ASC']]
    });

    res.render('admin/messages/show', {
      title: `Сообщение от ${message.name}`,
      message,
      prevMessage,
      nextMessage,
      layout: 'layouts/admin'
    });

  } catch (error) {
    console.error('Ошибка при загрузке сообщения:', error);
    req.flash('error', 'Ошибка при загрузке сообщения');
    res.redirect('/admin/messages');
  }
};

/**
 * 3. ОТВЕТИТЬ НА СООБЩЕНИЕ
 */
exports.replyToMessage = async (req, res) => {
  try {
    const messageId = req.params.id;
    const { reply_message } = req.body;
    const adminId = req.session.user.id;

    if (!reply_message || reply_message.trim().length < 5) {
      req.flash('error', 'Ответ должен содержать минимум 5 символов');
      return res.redirect(`/admin/messages/${messageId}`);
    }

    const message = await ContactMessage.findByPk(messageId);

    if (!message) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/admin/messages');
    }

    // Обновляем сообщение с ответом
    await message.update({
      is_replied: true,
      reply_message: reply_message.trim(),
      reply_date: new Date(),
      replied_by: adminId,
      is_read: true
    });

    // Отправляем email пользователю
    await sendReplyToUser(message, reply_message.trim());

    req.flash('success', 'Ответ отправлен пользователю');
    res.redirect(`/admin/messages/${messageId}`);

  } catch (error) {
    console.error('Ошибка при отправке ответа:', error);
    req.flash('error', 'Ошибка при отправке ответа');
    res.redirect(`/admin/messages/${req.params.id}`);
  }
};

/**
 * 4. АРХИВИРОВАТЬ СООБЩЕНИЕ
 */
exports.archiveMessage = async (req, res) => {
  try {
    const messageId = req.params.id;

    const message = await ContactMessage.findByPk(messageId);

    if (!message) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/admin/messages');
    }

    await message.update({ is_archived: true });

    req.flash('success', 'Сообщение перемещено в архив');
    res.redirect('/admin/messages');

  } catch (error) {
    console.error('Ошибка при архивации:', error);
    req.flash('error', 'Ошибка при архивации');
    res.redirect('/admin/messages');
  }
};

/**
 * 5. ВОССТАНОВИТЬ ИЗ АРХИВА
 */
exports.restoreMessage = async (req, res) => {
  try {
    const messageId = req.params.id;

    const message = await ContactMessage.findByPk(messageId);

    if (!message) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/admin/messages');
    }

    await message.update({ is_archived: false });

    req.flash('success', 'Сообщение восстановлено из архива');
    res.redirect('/admin/messages');

  } catch (error) {
    console.error('Ошибка при восстановлении:', error);
    req.flash('error', 'Ошибка при восстановлении');
    res.redirect('/admin/messages');
  }
};

/**
 * 6. УДАЛИТЬ СООБЩЕНИЕ
 */
exports.deleteMessage = async (req, res) => {
  try {
    const messageId = req.params.id;

    const message = await ContactMessage.findByPk(messageId);

    if (!message) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/admin/messages');
    }

    await message.destroy();

    req.flash('success', 'Сообщение удалено');
    res.redirect('/admin/messages');

  } catch (error) {
    console.error('Ошибка при удалении:', error);
    req.flash('error', 'Ошибка при удалении');
    res.redirect('/admin/messages');
  }
};

/**
 * 7. ДОБАВИТЬ ЗАМЕТКУ
 */
exports.addNote = async (req, res) => {
  try {
    const messageId = req.params.id;
    const { admin_notes } = req.body;

    const message = await ContactMessage.findByPk(messageId);

    if (!message) {
      req.flash('error', 'Сообщение не найдено');
      return res.redirect('/admin/messages');
    }

    await message.update({ admin_notes: admin_notes || null });

    req.flash('success', 'Заметка сохранена');
    res.redirect(`/admin/messages/${messageId}`);

  } catch (error) {
    console.error('Ошибка при сохранении заметки:', error);
    req.flash('error', 'Ошибка при сохранении заметки');
    res.redirect(`/admin/messages/${req.params.id}`);
  }
};

/**
 * 8. ОТПРАВКА СООБЩЕНИЯ С ПУБЛИЧНОЙ СТРАНИЦЫ
 */
exports.sendMessage = async (req, res) => {
  try {
    const { name, email, message: messageText } = req.body;
    
    // Валидация
    const errors = [];
    
    if (!name || name.length < 2) {
      errors.push('Имя должно содержать минимум 2 символа');
    }
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Введите корректный email');
    }
    
    if (!messageText || messageText.length < 10) {
      errors.push('Сообщение должно содержать минимум 10 символов');
    }
    
    if (errors.length > 0) {
      req.flash('error', errors.join('. '));
      return res.redirect('/contact');
    }
    
    // Создаём сообщение в базе данных
    const message = await ContactMessage.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      message: messageText.trim(),
      subject: 'Новое сообщение с формы обратной связи',
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.headers['user-agent'],
      is_read: false,
      is_replied: false,
      is_archived: false
    });
    
    // Отправляем уведомление администратору
    try {
      await sendAdminNotification(message);
    } catch (emailError) {
      console.error('Ошибка отправки email, но сообщение сохранено:', emailError);
    }
    
    req.flash('success', '✅ Сообщение отправлено! Мы свяжемся с вами в ближайшее время.');
    res.redirect('/contact');
    
  } catch (error) {
    console.error('Ошибка при сохранении сообщения:', error);
    req.flash('error', 'Произошла ошибка при отправке. Пожалуйста, попробуйте позже.');
    res.redirect('/contact');
  }
};

/**
 * 9. ПОЛУЧИТЬ СТАТИСТИКУ СООБЩЕНИЙ (для дашборда)
 */
exports.getMessageStats = async (req, res) => {
  try {
    const stats = {
      total: await ContactMessage.count({ where: { is_archived: false } }),
      unread: await ContactMessage.count({ where: { is_read: false, is_archived: false } }),
      replied: await ContactMessage.count({ where: { is_replied: true, is_archived: false } }),
      today: await ContactMessage.count({
        where: {
          createdAt: {
            [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
          },
          is_archived: false
        }
      })
    };
    
    res.json(stats);
    
  } catch (error) {
    console.error('Ошибка при получении статистики:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
};