const { User, PasswordReset, LoginAttempt } = require('../models');
const { Op, fn, col, where: sequelizeWhere } = require('sequelize');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

function normalizeIdentifier(identifier = '') {
  return identifier.trim().toLowerCase();
}

function renderDirectResetForm(res, data = {}) {
  return res.render('auth/forgot-password', {
    title: 'Восстановление пароля',
    identifier: data.identifier || '',
    errors: data.errors || [],
    layout: 'layouts/main'
  });
}

async function clearPasswordRecoveryLoginState(req, user) {
  await LoginAttempt.destroy({
    where: {
      email: normalizeIdentifier(user.email)
    }
  });

  req.session.showCaptcha = false;
  delete req.session.captcha;
  delete req.session.captchaExpires;
}

async function findUserByIdentifier(identifier) {
  const normalizedIdentifier = normalizeIdentifier(identifier);

  if (!normalizedIdentifier) {
    return { user: null, ambiguous: false };
  }

  const users = await User.findAll({
    where: {
      [Op.or]: [
        sequelizeWhere(fn('LOWER', col('email')), normalizedIdentifier),
        sequelizeWhere(fn('LOWER', col('name')), normalizedIdentifier)
      ]
    },
    limit: 2
  });

  if (users.length > 1) {
    return { user: null, ambiguous: true };
  }

  return { user: users[0] || null, ambiguous: false };
}

exports.getForgotPassword = (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  
  renderDirectResetForm(res);
};

exports.postForgotPassword = async (req, res) => {
  try {
    const identifier = (req.body.identifier || '').trim();
    const password = req.body.password || '';
    const passwordConfirm = req.body.password_confirm || '';
    const captcha = (req.body.captcha || '').trim().toLowerCase();
    const errors = [];

    if (!identifier) {
      errors.push({ msg: 'Введите имя пользователя или email аккаунта' });
    }

    if (!password || password.length < 6) {
      errors.push({ msg: 'Новый пароль должен содержать минимум 6 символов' });
    }

    if (password !== passwordConfirm) {
      errors.push({ msg: 'Пароли не совпадают' });
    }

    if (!req.session.captcha || !req.session.captchaExpires || req.session.captchaExpires < Date.now()) {
      errors.push({ msg: 'Срок действия проверочного кода истёк. Обновите код и попробуйте снова.' });
    } else if (captcha !== req.session.captcha) {
      errors.push({ msg: 'Неверный код с картинки' });
    }

    if (errors.length > 0) {
      return renderDirectResetForm(res, { identifier, errors });
    }

    delete req.session.captcha;

    const { user, ambiguous } = await findUserByIdentifier(identifier);

    if (ambiguous) {
      return renderDirectResetForm(res, {
        identifier,
        errors: [{ msg: 'Найдено несколько аккаунтов с таким именем. Укажите email аккаунта.' }]
      });
    }

    if (!user) {
      return renderDirectResetForm(res, {
        identifier,
        errors: [{ msg: 'Аккаунт с таким именем или email не найден' }]
      });
    }

    if (user.isBlocked) {
      return renderDirectResetForm(res, {
        identifier,
        errors: [{ msg: 'Аккаунт заблокирован. Обратитесь к администратору.' }]
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await user.update({ password_hash: hashedPassword });
    await clearPasswordRecoveryLoginState(req, user);

    req.flash('success', 'Пароль успешно изменён. Теперь вы можете войти с новым паролем.');
    return res.redirect('/auth/login');
    
  } catch (error) {
    console.error('Ошибка при восстановлении пароля:', error);
    req.flash('error', 'Произошла ошибка. Попробуйте позже.');
    return res.redirect('/auth/forgot-password');
  }
};

exports.getResetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    
    const resetRequest = await PasswordReset.findOne({
      where: {
        token,
        used: false,
        expires_at: { [Op.gt]: new Date() }
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email']
        }
      ]
    });
    
    if (!resetRequest) {
      req.flash('error', 'Ссылка для сброса пароля недействительна или истекла');
      return res.redirect('/auth/login');
    }
    
    res.render('auth/reset-password', {
      title: 'Новый пароль',
      token,
      layout: 'layouts/main'
    });
    
  } catch (error) {
    console.error('Ошибка при загрузке формы сброса:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/auth/login');
  }
};

exports.postResetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, password_confirm } = req.body;
    
    const errors = [];
    
    if (!password || password.length < 6) {
      errors.push({ msg: 'Пароль должен содержать минимум 6 символов' });
    }
    
    if (password !== password_confirm) {
      errors.push({ msg: 'Пароли не совпадают' });
    }
    
    if (errors.length > 0) {
      return res.render('auth/reset-password', {
        title: 'Новый пароль',
        token,
        errors,
        layout: 'layouts/main'
      });
    }
    
    const resetRequest = await PasswordReset.findOne({
      where: {
        token,
        used: false,
        expires_at: { [Op.gt]: new Date() }
      }
    });
    
    if (!resetRequest) {
      req.flash('error', 'Ссылка для сброса пароля недействительна или истекла');
      return res.redirect('/auth/login');
    }
    
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    const user = await User.findByPk(resetRequest.user_id);

    if (!user) {
      req.flash('error', 'Пользователь не найден');
      return res.redirect('/auth/login');
    }

    await user.update({ password_hash: hashedPassword });
    await resetRequest.update({ used: true });
    await clearPasswordRecoveryLoginState(req, user);
    
    req.flash('success', 'Пароль успешно изменён. Теперь вы можете войти.');
    res.redirect('/auth/login');
    
  } catch (error) {
    console.error('Ошибка при сбросе пароля:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/auth/login');
  }
};
