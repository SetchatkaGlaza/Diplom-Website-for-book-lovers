const svgCaptcha = require('svg-captcha');

exports.generateCaptcha = (req, res) => {
  try {
    const captcha = svgCaptcha.create({
      size: 4, // короткий код легче вводить пользователю
      noise: 0, // убираем шумные линии, чтобы каптча была читаемой
      color: false,
      background: '#ffffff',
      width: 160,
      height: 56,
      fontSize: 44,
      charPreset: '23456789' // только простые цифры без 0 и 1
    });
    
    req.session.captcha = captcha.text.toLowerCase();
    
    req.session.captchaExpires = Date.now() + 10 * 60 * 1000;
    
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
      req.flash('error', 'Срок действия каптчи истёк. Пожалуйста, обновите картинку.');
      return res.redirect('back');
    }
    
    if (captcha.toLowerCase() !== req.session.captcha) {
      req.flash('error', 'Проверочный код введён неверно');
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
