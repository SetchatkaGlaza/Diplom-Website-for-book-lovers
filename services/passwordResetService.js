const { User, PasswordResetToken } = require('../models');
const emailService = require('../config/email');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');

class PasswordResetService {
  /**
   * Создание запроса на сброс пароля
   */
  async createResetRequest(email) {
    const user = await User.findOne({ where: { email } });
    
    // Всегда возвращаем успех, даже если пользователь не найден (безопасность)
    if (!user) {
      return { success: true, message: 'Если пользователь существует, письмо отправлено' };
    }
    
    // Удаляем старые неиспользованные токены
    await PasswordResetToken.destroy({
      where: {
        user_id: user.id,
        used: false,
        expires_at: { [Op.lt]: new Date() }
      }
    });
    
    // Создаём новый токен
    const token = PasswordResetToken.generateToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // токен действует 1 час
    
    await PasswordResetToken.create({
      user_id: user.id,
      token,
      expires_at: expiresAt
    });
    
    // Отправляем письмо
    const resetLink = `${process.env.BASE_URL || 'http://localhost:3000'}/auth/reset-password/${token}`;
    
    await emailService.sendPasswordResetEmail(user.email, user.name, resetLink);
    
    return { success: true };
  }
  
  /**
   * Проверка валидности токена
   */
  async validateResetToken(token) {
    const resetToken = await PasswordResetToken.findOne({
      where: {
        token,
        used: false,
        expires_at: { [Op.gt]: new Date() }
      },
      include: [{ model: User, as: 'user' }]
    });
    
    if (!resetToken) {
      return { valid: false };
    }
    
    return {
      valid: true,
      token: resetToken,
      user: resetToken.user
    };
  }
  
  /**
   * Сброс пароля
   */
  async resetPassword(token, newPassword) {
    const validation = await this.validateResetToken(token);
    
    if (!validation.valid) {
      return { success: false, error: 'Недействительный или истёкший токен' };
    }
    
    // Хешируем новый пароль
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Обновляем пароль пользователя
    await validation.user.update({
      password_hash: hashedPassword
    });
    
    // Помечаем токен как использованный
    await validation.token.update({
      used: true
    });
    
    return { success: true };
  }
}

module.exports = new PasswordResetService();