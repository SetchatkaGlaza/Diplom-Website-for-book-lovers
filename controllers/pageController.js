const emailService = require('../config/email');

exports.getAbout = (req, res) => {
  res.render('pages/about', {
    title: 'О проекте'
  });
};

exports.getFaq = (req, res) => {
  const faqItems = [
    {
      id: 'how-to',
      question: 'Как написать рецензию?',
      answer: 'Чтобы написать рецензию, нужно быть авторизованным пользователем. Перейдите на страницу книги, которую вы прочитали, и нажмите кнопку "Написать рецензию". Заполните форму с оценкой и текстом. Рецензия будет отправлена на модерацию.'
    },
    {
      id: 'moderation',
      question: 'Как проходит модерация рецензий?',
      answer: 'Все рецензии проходят проверку модераторами. Обычно это занимает не более 24 часов. Рецензии, нарушающие правила сайта, могут быть отклонены.'
    },
    {
      id: 'bookshelves',
      question: 'Что такое "полки с книгами"?',
      answer: 'Вы можете добавлять книги в три списка: "Хочу прочитать", "Читаю сейчас" и "Прочитано". Это помогает отслеживать ваш прогресс и делиться им с другими.'
    },
    {
      id: 'rating',
      question: 'Как формируется рейтинг книг?',
      answer: 'Рейтинг книги рассчитывается как среднее арифметическое всех оценок, оставленных пользователями. Учитываются только оценки от пользователей, чьи рецензии прошли модерацию.'
    },
    {
      id: 'profile',
      question: 'Как изменить информацию в профиле?',
      answer: 'Зайдите в личный кабинет, нажмите "Редактировать профиль". Там вы можете изменить имя, bio, аватарку и пароль.'
    },
    {
      id: 'privacy',
      question: 'Кто видит мои полки с книгами?',
      answer: 'Сейчас все полки публичны — другие пользователи могут видеть, какие книги вы добавили. В будущем мы добавим настройки приватности.'
    }
  ];
  
  res.render('pages/faq', {
    title: 'Часто задаваемые вопросы',
    faqItems
  });
};

exports.getRules = (req, res) => {
  res.render('pages/rules', {
    title: 'Правила сайта'
  });
};

exports.getContact = (req, res) => {
  res.render('pages/contact', {
    title: 'Контакты'
  });
};

exports.postContact = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    
    const errors = [];
    
    if (!name || name.length < 2) {
      errors.push({ msg: 'Имя должно содержать минимум 2 символа' });
    }
    
    if (!email || !email.includes('@')) {
      errors.push({ msg: 'Введите корректный email' });
    }
    
    if (!subject || subject.length < 3) {
      errors.push({ msg: 'Тема должна содержать минимум 3 символа' });
    }
    
    if (!message || message.length < 10) {
      errors.push({ msg: 'Сообщение должно содержать минимум 10 символов' });
    }
    
    if (errors.length > 0) {
      return res.render('pages/contact', {
        title: 'Контакты',
        errors,
        formData: { name, email, subject, message }
      });
    }

    const result = await emailService.sendContactEmail(name, email, subject, message);
    
    if (result.success) {
      req.flash('success', 'Сообщение отправлено! Мы ответим вам в ближайшее время.');
    } else {
      req.flash('error', 'Произошла ошибка при отправке. Попробуйте позже.');
    }
    
    res.redirect('/contact');
    
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    req.flash('error', 'Произошла ошибка при отправке');
    res.redirect('/contact');
  }
};
