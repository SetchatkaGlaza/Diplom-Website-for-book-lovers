const { User, PasswordReset } = require('../models');
const crypto = require('crypto');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const emailService = require('../config/email');

const SALT_ROUNDS = 10;

exports.getForgotPassword = (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  
  res.render('auth/forgot-password', {
    title: 'Восстановление пароля',
    layout: 'layouts/main'
  });
};

exports.postForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      req.flash('error', 'Введите email');
      return res.redirect('/auth/forgot-password');
    }
    
    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      req.flash('success', 'Если указанный email зарегистрирован, на него отправлена инструкция');
      return res.redirect('/auth/login');
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час
    
    await PasswordReset.create({
      user_id: user.id,
      token,
      expires_at: expiresAt,
      used: false
    });
    
    const resetLink = `${req.protocol}://${req.get('host')}/auth/reset-password/${token}`;
    
    await emailService.sendPasswordResetEmail(user.email, user.name, resetLink);
    
    req.flash('success', 'Инструкция по восстановлению пароля отправлена на ваш email');
    res.redirect('/auth/login');
    
  } catch (error) {
    console.error('Ошибка при запросе сброса пароля:', error);
    req.flash('error', 'Произошла ошибка. Попробуйте позже.');
    res.redirect('/auth/forgot-password');
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
    
    await User.update(
      { password_hash: hashedPassword },
      { where: { id: resetRequest.user_id } }
    );
    
    await resetRequest.update({ used: true });
    
    req.flash('success', 'Пароль успешно изменён. Теперь вы можете войти.');
    res.redirect('/auth/login');
    
  } catch (error) {
    console.error('Ошибка при сбросе пароля:', error);
    req.flash('error', 'Произошла ошибка');
    res.redirect('/auth/login');
  }
};
