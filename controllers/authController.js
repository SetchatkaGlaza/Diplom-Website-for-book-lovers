const bcrypt = require('bcrypt');
const { User, LoginAttempt } = require('../models');
const { fn, col, where: sequelizeWhere } = require('sequelize');
const notificationService = require('../services/notificationService');
const { validateEmail: validateEmailInput, validatePersonName, validatePassword: validatePasswordInput } = require('../utils/validators');

const SALT_ROUNDS = 10;
const CAPTCHA_THRESHOLD = 3;

function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

async function findUserByEmail(email) {
  return User.findOne({
    where: sequelizeWhere(fn('LOWER', col('email')), normalizeEmail(email))
  });
}

function createSessionUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    avatar_public_id: user.avatar_public_id || null
  };
}

function persistLoginSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        return reject(error);
      }

      req.session.user = createSessionUser(user);
      resolve();
    });
  });
}

function renderLogin(res, { errors = [], email = '', showCaptcha = false } = {}) {
  return res.render('auth/login', {
    title: 'Вход',
    showCaptcha,
    errors,
    email,
    layout: 'layouts/main'
  });
}

function renderRegister(res, { errors = [], name = '', email = '', agree = false } = {}) {
  return res.render('auth/register', {
    title: 'Регистрация',
    errors,
    name,
    email,
    agree,
    layout: 'layouts/main'
  });
}

function validateCaptchaInput(req, captcha) {
  if (!captcha) {
    return 'Введите проверочный код с картинки';
  }

  if (!req.session.captcha || !req.session.captchaExpires || req.session.captchaExpires < Date.now()) {
    return 'Срок действия проверочного кода истёк. Обновите картинку и попробуйте снова';
  }

  if (captcha !== req.session.captcha) {
    return 'Проверочный код введён неверно';
  }

  delete req.session.captcha;
  delete req.session.captchaExpires;
  return null;
}

function validateEmail(email) {
  return validateEmailInput(email).error;
}

function validateUsername(name) {
  return validatePersonName(name, 'Имя пользователя').error;
}

function validatePassword(password) {
  return validatePasswordInput(password).error;
}


async function getLoginAttempt(ip, email) {
  return LoginAttempt.findOne({
    where: {
      ip_address: ip,
      email
    }
  });
}

async function getLoginAttempts(ip, email) {
  try {
    const attempt = await getLoginAttempt(ip, email);
    return attempt ? attempt.attempts : 0;
  } catch (error) {
    console.error('Ошибка при проверке попыток входа:', error);
    return 0;
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
      blocked_until: null,
      last_attempt: now
    });
    return { attempts: 1 };
  }

  const nextAttempts = attempt.attempts + 1;

  await attempt.update({
    attempts: nextAttempts,
    blocked_until: null,
    last_attempt: now
  });

  return { attempts: nextAttempts };
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
  return renderLogin(res, { showCaptcha });
};

exports.postLogin = async (req, res) => {
  const email = normalizeEmail(req.body.email || '');
  const password = req.body.password || '';
  const captcha = (req.body.captcha || '').trim().toLowerCase();
  const ip = req.ip;

  try {
    const errors = [];
    const emailError = validateEmail(email);
    const passwordError = !password ? 'Введите пароль' : null;
    let previousAttempts = 0;

    if (emailError) {
      errors.push({ msg: emailError });
    }

    if (passwordError) {
      errors.push({ msg: passwordError });
    }

    if (!emailError) {
      previousAttempts = await getLoginAttempts(ip, email);
    }

    const shouldValidateCaptcha = req.session.showCaptcha === true || previousAttempts >= CAPTCHA_THRESHOLD;

    if (shouldValidateCaptcha) {
      const captchaError = validateCaptchaInput(req, captcha);
      if (captchaError) {
        req.session.showCaptcha = true;
        errors.push({ msg: captchaError });
      }
    }

    if (errors.length > 0) {
      return renderLogin(res, {
        errors,
        email,
        showCaptcha: req.session.showCaptcha === true || previousAttempts >= CAPTCHA_THRESHOLD
      });
    }

    const user = await findUserByEmail(email);

    if (!user) {
      const failResult = await registerFailedLogin(ip, email);
      req.session.showCaptcha = failResult.attempts >= CAPTCHA_THRESHOLD;

      return renderLogin(res, {
        errors: [{ msg: 'Пользователь с таким email не найден' }],
        email,
        showCaptcha: req.session.showCaptcha
      });
    }

    if (user.isBlocked) {
      if (user.blocked_until && user.blocked_until > new Date()) {
        const waitMinutes = Math.ceil((user.blocked_until - new Date()) / (60 * 1000));
        errors.push({ msg: `Аккаунт заблокирован администратором. Попробуйте через ${waitMinutes} минут.` });
      } else if (user.blocked_until && user.blocked_until <= new Date()) {
        await user.update({ isBlocked: false, blocked_until: null });
      } else {
        errors.push({ msg: 'Аккаунт заблокирован администратором' });
      }

      if (errors.length > 0) {
        return renderLogin(res, {
          errors,
          email,
          showCaptcha: req.session.showCaptcha === true
        });
      }
    }

    const storedPasswordHash = String(user.password_hash || '').trim();
    const isMatch = await bcrypt.compare(password, storedPasswordHash);

    if (!isMatch) {
      const failResult = await registerFailedLogin(ip, email);
      req.session.showCaptcha = failResult.attempts >= CAPTCHA_THRESHOLD;

      return renderLogin(res, {
        errors: [{ msg: 'Пароль указан неверно' }],
        email,
        showCaptcha: req.session.showCaptcha
      });
    }

    await resetLoginAttempts(ip, email);
    req.session.showCaptcha = false;
    delete req.session.captcha;
    delete req.session.captchaExpires;

    const redirectTo = req.session.returnTo || '/';
    await persistLoginSession(req, user);

    req.flash('success', 'Вы успешно вошли в систему!');

    delete req.session.returnTo;
    res.redirect(redirectTo);

  } catch (error) {
    console.error('Ошибка при входе:', error);
    return renderLogin(res, {
      errors: [{ msg: 'Произошла ошибка при входе. Попробуйте ещё раз' }],
      email,
      showCaptcha: req.session.showCaptcha === true
    });
  }
};

exports.getRegister = (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  
  return renderRegister(res);
};

exports.postRegister = async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = normalizeEmail(req.body.email || '');
  const password = req.body.password || '';
  const password2 = req.body.password2 || '';
  const captcha = (req.body.captcha || '').trim().toLowerCase();
  const agree = req.body.agree === 'on';

  try {
    const errors = [];
    const usernameError = validateUsername(name);
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);

    if (usernameError) {
      errors.push({ msg: usernameError });
    }

    if (emailError) {
      errors.push({ msg: emailError });
    }

    if (passwordError) {
      errors.push({ msg: passwordError });
    }

    if (!password2) {
      errors.push({ msg: 'Повторите пароль' });
    } else if (password && password !== password2) {
      errors.push({ msg: 'Пароли не совпадают' });
    }

    if (!agree) {
      errors.push({ msg: 'Подтвердите согласие с правилами сайта' });
    }

    const captchaError = validateCaptchaInput(req, captcha);
    if (captchaError) {
      errors.push({ msg: captchaError });
    }

    if (errors.length > 0) {
      return renderRegister(res, { errors, name, email, agree });
    }

    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      errors.push({ msg: 'Пользователь с таким email уже существует' });
      return renderRegister(res, { errors, name, email, agree });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = await User.create({
      name: validatePersonName(name, 'Имя пользователя').value,
      email,
      password_hash: hashedPassword,
      role: 'user',
      avatar: 'default-avatar.png',
      isBlocked: false,
      email_verified: false
    });

    await notificationService.welcomeNewUser(newUser.id, newUser.name);

    await persistLoginSession(req, newUser);

    req.flash('success', 'Регистрация прошла успешно! Добро пожаловать!');
    res.redirect('/');

  } catch (error) {
    console.error('Ошибка при регистрации:', error);
    return renderRegister(res, {
      errors: [{ msg: 'Произошла ошибка при регистрации. Попробуйте ещё раз' }],
      name,
      email,
      agree
    });
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
