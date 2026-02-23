const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// GET /auth/register - показать форму регистрации
router.get('/register', authController.getRegister);

// POST /auth/register - обработать регистрацию
router.post('/register', authController.postRegister);

// GET /auth/login - показать форму входа
router.get('/login', authController.getLogin);

// POST /auth/login - обработать вход
router.post('/login', authController.postLogin);

// GET /auth/logout - выйти из системы
router.get('/logout', authController.logout);

module.exports = router;