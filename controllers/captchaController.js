const svgCaptcha = require('svg-captcha');

exports.generateCaptcha = (req, res) => {
  try {
    const captcha = svgCaptcha.create({
      size: 6, // количество символов
      noise: 2, // количество линий шума
      color: true,
      background: '#f0f0f0',
      width: 200,
      height: 70,
      fontSize: 50,
      charPreset: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789' // без сложных символов
    });
    
    req.session.captcha = captcha.text.toLowerCase();
    
    req.session.captchaExpires = Date.now() + 5 * 60 * 1000;
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(captcha.data);
    
  } catch (error) {
    console.error('Ошибка при генерации каптчи:', error);
    res.status(500).send('Ошибка при генерации каптчи');
  }
};

exports.validateCaptcha = (req, res, next) => {
  try {
    const { captcha } = req.body;
    
    if (!captcha) {
      req.flash('error', 'Пожалуйста, введите код с картинки');
      return res.redirect('back');
    }
    
    if (!req.session.captcha || !req.session.captchaExpires || req.session.captchaExpires < Date.now()) {
      req.flash('error', 'Срок действия каптчи истёк. Пожалуйста, обновите страницу.');
      return res.redirect('back');
    }
    
    if (captcha.toLowerCase() !== req.session.captcha) {
      req.flash('error', 'Неверный код с картинки');
      return res.redirect('back');
    }
    
    delete req.session.captcha;
    delete req.session.captchaExpires;
    
    next();
    
  } catch (error) {
    console.error('Ошибка при проверке каптчи:', error);
    req.flash('error', 'Ошибка при проверке каптчи');
    res.redirect('back');
  }
};
