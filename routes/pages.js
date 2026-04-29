const express = require('express');
const router = express.Router();
const pageController = require('../controllers/pageController');

router.get('/about', pageController.getAbout);
router.get('/faq', pageController.getFaq);
router.get('/rules', pageController.getRules);
router.get('/contact', pageController.getContact);
router.post('/contact', pageController.postContact);

module.exports = router;
