const bcrypt = require('bcrypt');
const { User, LoginAttempt } = require('../models');
const notificationService = require('../services/notificationService');

const SALT_ROUNDS = 10;
const MAX_LOGIN_ATTEMPTS = 5;
const CAPTCHA_THRESHOLD = 3;
const BLOCK_TIME = 15 * 60 * 1000; // 15 минут в миллисекундах

async function getLoginAttempt(ip, email) {
  return LoginAttempt.findOne({
    where: {
      ip_address: ip,
      email
    }
  });
}

async function checkLoginAttempts(ip, email) {
  try {
    const attempt = await getLoginAttempt(ip, email);
    
    if (!attempt) {
      return { allowed: true, attempts: 0 };
    }
    
    if (attempt.blocked_until && attempt.blocked_until > new Date()) {
      const waitMinutes = Math.ceil((attempt.blocked_until - new Date()) / (60 * 1000));
      return { 
        allowed: false, 
        blocked: true, 
        waitMinutes,
        attempts: attempt.attempts 
      };
    }
    
    if (attempt.blocked_until && attempt.blocked_until <= new Date()) {
      await attempt.update({
        attempts: 0,
        blocked_until: null,
        last_attempt: new Date()
      });
      return { allowed: true, attempts: 0 };
    }
    
    return {
      allowed: true,
      attempts: attempt.attempts,
      remaining: MAX_LOGIN_ATTEMPTS - attempt.attempts
    };
    
  } catch (error) {
    console.error('Ошибка при проверке попыток входа:', error);
    return { allowed: true, attempts: 0 };
  }
}

async function registerFailedLogin(ip, email) {
  const now = new Date();
  const attempt = await getLoginAttempt(ip, email);

  if (!attempt) {
    await LoginAttempt.create({
      ip_address: ip,
      email,
      attempts: 1,
      last_attempt: now
    });
    return { blocked: false, attempts: 1 };
  }

  const nextAttempts = attempt.attempts + 1;
  const shouldBlock = nextAttempts >= MAX_LOGIN_ATTEMPTS;

  await attempt.update({
    attempts: nextAttempts,
    blocked_until: shouldBlock ? new Date(Date.now() + BLOCK_TIME) : null,
    last_attempt: now
  });

  return { blocked: shouldBlock, attempts: nextAttempts };
}

async function resetLoginAttempts(ip, email) {
  try {
    await LoginAttempt.destroy({
      where: {
        ip_address: ip,
        email: email
      }
    });
  } catch (error) {
    console.error('Ошибка при сбросе попыток:', error);
  }
}

exports.getLogin = async (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  
  const showCaptcha = req.session.showCaptcha === true;
  
  res.render('auth/login', {
    title: 'Вход',
    showCaptcha,
    errors: [],
    email: '',      
    layout: 'layouts/main'
  });
};

exports.postLogin = async (req, res) => {
  try {
    const { email, password, captcha } = req.body;
    const ip = req.ip;
    
    const attemptCheck = await checkLoginAttempts(ip, email);
    
    if (!attemptCheck.allowed) {
      if (attemptCheck.blocked) {
        req.flash('error', `Слишком много неудачных попыток. Попробуйте через ${attemptCheck.waitMinutes} минут.`);
      } else {
        req.flash('error', 'Превышено количество попыток. Попробуйте позже.');
      }
      return res.redirect('/auth/login');
    }
    
    const shouldShowCaptcha = attemptCheck.attempts >= CAPTCHA_THRESHOLD;

    if (shouldShowCaptcha) {
      if (!captcha) {
        req.session.showCaptcha = true;
        req.flash('error', 'Пожалуйста, введите код с картинки');
        return res.redirect('/auth/login');
      }
      
      if (!req.session.captcha || captcha.toLowerCase() !== req.session.captcha) {
        req.session.showCaptcha = true;
        req.flash('error', 'Неверный код с картинки');
        return res.redirect('/auth/login');
      }
      
      delete req.session.captcha;
    }
    
    if (!email || !password) {
      req.flash('error', 'Пожалуйста, введите email и пароль');
      return res.redirect('/auth/login');
    }
    
    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      const failResult = await registerFailedLogin(ip, email);
      req.session.showCaptcha = failResult.attempts >= CAPTCHA_THRESHOLD;
      if (failResult.blocked) {
        req.flash('error', 'Слишком много неудачных попыток. Попробуйте через 15 минут.');
        return res.redirect('/auth/login');
      }
      req.flash('error', 'Неверный email или пароль');
      return res.redirect('/auth/login');
    }
    
    if (user.isBlocked) {
      if (user.blocked_until && user.blocked_until > new Date()) {
        const waitMinutes = Math.ceil((user.blocked_until - new Date()) / (60 * 1000));
        req.flash('error', `Аккаунт заблокирован. Попробуйте через ${waitMinutes} минут.`);
      } else if (user.blocked_until && user.blocked_until <= new Date()) {
        await user.update({ isBlocked: false, blocked_until: null });
      } else {
        req.flash('error', 'Аккаунт заблокирован администратором');
      }
      return res.redirect('/auth/login');
    }
    
    const isMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!isMatch) {
      const failResult = await registerFailedLogin(ip, email);
      req.session.showCaptcha = failResult.attempts >= CAPTCHA_THRESHOLD;
      if (failResult.blocked) {
        req.flash('error', 'Слишком много неудачных попыток. Попробуйте через 15 минут.');
        return res.redirect('/auth/login');
      }
      req.flash('error', 'Неверный email или пароль');
      return res.redirect('/auth/login');
    }
    
    await resetLoginAttempts(ip, email);
    req.session.showCaptcha = false;
    
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar
    };
    
    req.flash('success', 'Вы успешно вошли в систему!');
    
    const redirectTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(redirectTo);
    
  } catch (error) {
    console.error('Ошибка при входе:', error);
    req.flash('error', 'Произошла ошибка при входе');
    res.redirect('/auth/login');
  }
};

exports.getRegister = (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  
  res.render('auth/register', {
    title: 'Регистрация',
    errors: [],
    name: '',     
    email: '',
    layout: 'layouts/main'
  });
};

exports.postRegister = async (req, res) => {
  try {
    const { name, email, password, password2, captcha } = req.body;
    
    if (!req.session.captcha || captcha.toLowerCase() !== req.session.captcha) {
      req.flash('error', 'Неверный код с картинки');
      return res.redirect('/auth/register');
    }
    
    delete req.session.captcha;
    
    const errors = [];

    if (!name || !email || !password || !password2) {
      errors.push({ msg: 'Пожалуйста, заполните все поля' });
    }

    if (name && name.length < 2) {
      errors.push({ msg: 'Имя должно содержать минимум 2 символа' });
    }

    if (password && password.length < 6) {
      errors.push({ msg: 'Пароль должен содержать минимум 6 символов' });
    }

    if (password !== password2) {
      errors.push({ msg: 'Пароли не совпадают' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) {
      errors.push({ msg: 'Введите корректный email' });
    }

    if (errors.length > 0) {
      return res.render('auth/register', {
        title: 'Регистрация',
        errors,
        name,
        email,
        layout: 'layouts/main'
      });
    }

    const existingUser = await User.findOne({ where: { email } });
    
    if (existingUser) {
      errors.push({ msg: 'Пользователь с таким email уже существует' });
      return res.render('auth/register', {
        title: 'Регистрация',
        errors,
        name,
        email,
        layout: 'layouts/main'
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = await User.create({
      name,
      email,
      password_hash: hashedPassword,
      role: 'user',
      avatar: 'default-avatar.png',
      isBlocked: false,
      email_verified: false
    });

    await notificationService.welcomeNewUser(newUser.id, newUser.name);

    req.session.user = {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      avatar: newUser.avatar
    };

    req.flash('success', 'Регистрация прошла успешно! Добро пожаловать!');
    res.redirect('/');

  } catch (error) {
    console.error('Ошибка при регистрации:', error);
    req.flash('error', 'Произошла ошибка при регистрации');
    res.redirect('/auth/register');
  }
};

exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Ошибка при выходе:', err);
    }
    res.redirect('/');
  });
};
