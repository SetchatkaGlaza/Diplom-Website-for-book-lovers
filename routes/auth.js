const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const passwordController = require('../controllers/passwordController');
const captchaController = require('../controllers/captchaController');
const { requireGuest } = require('../middlewares/authMiddleware');

// Каптча
router.get('/captcha', captchaController.generateCaptcha);

// Регистрация
router.get('/register', requireGuest, authController.getRegister);
router.post('/register', requireGuest, authController.postRegister);

// Вход
router.get('/login', requireGuest, authController.getLogin);
router.post('/login', requireGuest, authController.postLogin);

// Выход
router.get('/logout', authController.logout);

// Восстановление пароля
router.get('/forgot-password', requireGuest, passwordController.getForgotPassword);
router.post('/forgot-password', requireGuest, passwordController.postForgotPassword);

// Сброс пароля по токену
router.get('/reset-password/:token', requireGuest, passwordController.getResetPassword);
router.post('/reset-password/:token', requireGuest, passwordController.postResetPassword);

module.exports = router;