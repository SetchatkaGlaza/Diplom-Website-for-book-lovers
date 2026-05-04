const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const captchaController = require('../controllers/captchaController');
const { requireGuest } = require('../middlewares/authMiddleware');

router.get('/captcha', captchaController.generateCaptcha);

router.get('/register', requireGuest, authController.getRegister);
router.post('/register', requireGuest, authController.postRegister);

router.get('/login', requireGuest, authController.getLogin);
router.post('/login', requireGuest, authController.postLogin);

router.get('/logout', authController.logout);


module.exports = router;
