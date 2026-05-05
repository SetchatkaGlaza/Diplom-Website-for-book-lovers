const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const captchaController = require('../controllers/captchaController');
const passwordController = require('../controllers/passwordController');
const { requireGuest } = require('../middlewares/authMiddleware');

router.get('/captcha', captchaController.generateCaptcha);

router.get('/register', requireGuest, authController.getRegister);
router.post('/register', requireGuest, authController.postRegister);

router.get('/login', requireGuest, authController.getLogin);
router.post('/login', requireGuest, authController.postLogin);

router.get('/forgot-password', requireGuest, passwordController.getForgotPassword);
router.post('/forgot-password', requireGuest, passwordController.postForgotPassword);
router.get('/reset-password/:token', requireGuest, passwordController.getResetPassword);
router.post('/reset-password/:token', requireGuest, passwordController.postResetPassword);

router.get('/logout', authController.logout);


module.exports = router;
