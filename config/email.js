const nodemailer = require('nodemailer');
require('dotenv').config();


const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER || 'korepin.123valerii@gmail.com',
    pass: process.env.EMAIL_PASS || 'pxss frhj bnax iyrx'
  }
});

/**
 * Отправка письма для сброса пароля
 */
exports.sendPasswordResetEmail = async (toEmail, toName, resetLink) => {
  try {
    const mailOptions = {
      from: `"Книгоманы" <${process.env.EMAIL_USER || 'noreply@booklovers.ru'}>`,
      to: toEmail,
      subject: 'Восстановление пароля - Книгоманы',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 10px 10px 0 0; }
            .content { padding: 30px; background: #f9f9f9; border: 1px solid #ddd; }
            .button { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📚 Книгоманы</h1>
            </div>
            <div class="content">
              <h2>Здравствуйте, ${toName}!</h2>
              <p>Вы получили это письмо, потому что запросили сброс пароля на сайте "Книгоманы".</p>
              <p>Для установки нового пароля нажмите на кнопку ниже:</p>
              <div style="text-align: center;">
                <a href="${resetLink}" class="button">Сбросить пароль</a>
              </div>
              <p>Если кнопка не работает, скопируйте ссылку в браузер:</p>
              <p style="word-break: break-all;">${resetLink}</p>
              <p><strong>Ссылка действительна в течение 1 часа.</strong></p>
              <p>Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
            </div>
            <div class="footer">
              <p>© 2026 Книгоманы. Все права защищены.</p>
              <p>Это автоматическое письмо, пожалуйста, не отвечайте на него.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`Письмо для сброса пароля отправлено на ${toEmail}`);
    return { success: true };
    
  } catch (error) {
    console.error('Ошибка при отправке письма для сброса пароля:', error);
    return { success: false, error };
  }
};

/**
 * Отправка письма администратору с формы обратной связи
 */
exports.sendContactEmail = async (name, email, subject, message) => {
  try {
    // Письмо администратору
    const adminMailOptions = {
      from: `"Книгоманы" <${process.env.EMAIL_USER || 'noreply@booklovers.ru'}>`,
      to: process.env.ADMIN_EMAIL || 'korepin.123valerii@gmail.com',
      subject: `[Книгоманы] Новое сообщение: ${subject}`,
      html: `
        <h2>Новое сообщение с формы обратной связи</h2>
        <p><strong>От:</strong> ${name} (${email})</p>
        <p><strong>Тема:</strong> ${subject}</p>
        <p><strong>Сообщение:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <hr>
        <p>Отправлено: ${new Date().toLocaleString('ru-RU')}</p>
      `
    };
    
    // Письмо пользователю (подтверждение)
    const userMailOptions = {
      from: `"Книгоманы" <${process.env.EMAIL_USER || 'noreply@booklovers.ru'}>`,
      to: email,
      subject: 'Ваше сообщение получено - Книгоманы',
      html: `
        <h2>Здравствуйте, ${name}!</h2>
        <p>Мы получили ваше сообщение и ответим вам в ближайшее время.</p>
        <p><strong>Ваше сообщение:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <hr>
        <p>С уважением, команда Книгоманы</p>
      `
    };
    
    // Отправляем письмо администратору
    await transporter.sendMail(adminMailOptions);
    
    // Отправляем подтверждение пользователю
    await transporter.sendMail(userMailOptions);
    
    return { success: true };
  } catch (error) {
    console.error('Ошибка при отправке email:', error);
    return { success: false, error };
  }
};

/**
 * Отправка ответа пользователю от администратора
 */
exports.sendReplyEmail = async (toEmail, toName, subject, message) => {
  try {
    const mailOptions = {
      from: `"Книгоманы" <${process.env.EMAIL_USER || 'noreply@booklovers.ru'}>`,
      to: toEmail,
      subject: `Re: ${subject}`,
      html: `
        <h2>Здравствуйте, ${toName}!</h2>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <hr>
        <p>С уважением, команда Книгоманы</p>
      `
    };
    
    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    console.error('Ошибка при отправке ответа:', error);
    return { success: false, error };
  }
};