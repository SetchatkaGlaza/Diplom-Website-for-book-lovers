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