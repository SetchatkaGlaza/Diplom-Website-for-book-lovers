const bcrypt = require('bcrypt');
const User = require('../models/User'); // импортируем модель User

// Количество раундов соли для bcrypt (чем больше, тем безопаснее, но медленнее)
const SALT_ROUNDS = 10;

/**
 * 1. ПОКАЗ ФОРМЫ РЕГИСТРАЦИИ
 */
exports.getRegister = (req, res) => {
  // Если пользователь уже залогинен, отправляем на главную
  if (req.session.user) {
    return res.redirect('/');
  }
  
  res.render('auth/register', {
    title: 'Регистрация',
    errors: [] // пока ошибок нет
  });
};

/**
 * 2. ОБРАБОТКА РЕГИСТРАЦИИ
 */
exports.postRegister = async (req, res) => {
  try {
    // Получаем данные из формы (req.body благодаря express.urlencoded)
    const { name, email, password, password2 } = req.body;
    
    // Массив для ошибок валидации
    const errors = [];

    // ВАЛИДАЦИЯ
    // 1. Проверяем, что все поля заполнены
    if (!name || !email || !password || !password2) {
      errors.push({ msg: 'Пожалуйста, заполните все поля' });
    }

    // 2. Проверяем длину имени
    if (name && name.length < 2) {
      errors.push({ msg: 'Имя должно содержать минимум 2 символа' });
    }

    // 3. Проверяем пароль (минимум 6 символов)
    if (password && password.length < 6) {
      errors.push({ msg: 'Пароль должен содержать минимум 6 символов' });
    }

    // 4. Проверяем, что пароли совпадают
    if (password !== password2) {
      errors.push({ msg: 'Пароли не совпадают' });
    }

    // 5. Проверяем формат email (регулярное выражение)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) {
      errors.push({ msg: 'Введите корректный email' });
    }

    // Если есть ошибки — показываем форму снова
    if (errors.length > 0) {
      return res.render('auth/register', {
        title: 'Регистрация',
        errors,
        name,
        email
      });
    }

    // Проверяем, существует ли уже пользователь с таким email
    const existingUser = await User.findOne({ where: { email } });
    
    if (existingUser) {
      errors.push({ msg: 'Пользователь с таким email уже существует' });
      return res.render('auth/register', {
        title: 'Регистрация',
        errors,
        name,
        email
      });
    }

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Создаём запись в БД
    const newUser = await User.create({
      name,
      email,
      password_hash: hashedPassword,
      role: 'user', // обычный пользователь
      avatar: 'default-avatar.png'
    });

    // Сохраняем пользователя в сессию (автоматический вход после регистрации)
    req.session.user = {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      avatar: newUser.avatar
    };

    // Отправляем flash-сообщение об успехе
    req.flash('success', 'Регистрация прошла успешно! Добро пожаловать!');
    
    // Редирект на главную
    res.redirect('/');

  } catch (error) {
    console.error('Ошибка при регистрации:', error);
    req.flash('error', 'Произошла ошибка при регистрации');
    res.redirect('/auth/register');
  }
};

/**
 * 3. ПОКАЗ ФОРМЫ ВХОДА
 */
exports.getLogin = (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  
  res.render('auth/login', {
    title: 'Вход',
    errors: []
  });
};

/**
 * 4. ОБРАБОТКА ВХОДА
 */
exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const errors = [];

    // Проверяем, что поля заполнены
    if (!email || !password) {
      errors.push({ msg: 'Пожалуйста, введите email и пароль' });
      return res.render('auth/login', {
        title: 'Вход',
        errors,
        email
      });
    }

    // Ищем пользователя по email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      errors.push({ msg: 'Неверный email или пароль' });
      return res.render('auth/login', {
        title: 'Вход',
        errors,
        email
      });
    }

    // Сравниваем пароль с хешем в БД
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      errors.push({ msg: 'Неверный email или пароль' });
      return res.render('auth/login', {
        title: 'Вход',
        errors,
        email
      });
    }

    // Всё правильно — сохраняем пользователя в сессию
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar
    };

    req.flash('success', 'Вы успешно вошли в систему!');
    res.redirect('/');

  } catch (error) {
    console.error('Ошибка при входе:', error);
    req.flash('error', 'Произошла ошибка при входе');
    res.redirect('/auth/login');
  }
};

/**
 * 5. ВЫХОД ИЗ СИСТЕМЫ
 */
exports.logout = (req, res) => {
  // Удаляем пользователя из сессии
  req.session.destroy((err) => {
    if (err) {
      console.error('Ошибка при выходе:', err);
    }
    res.redirect('/');
  });
};