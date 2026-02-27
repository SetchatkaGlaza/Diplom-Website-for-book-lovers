const { LoginAttempt } = require('../models');
const { Op } = require('sequelize');

class SecurityService {
  /**
   * Проверка, не заблокирован ли пользователь/IP
   */
  async isBlocked(email, ip) {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Проверяем неудачные попытки за последние 15 минут для email
    const recentEmailAttempts = await LoginAttempt.count({
      where: {
        email,
        successful: false,
        attempted_at: { [Op.gte]: fifteenMinutesAgo }
      }
    });
    
    // Проверяем неудачные попытки за последний час для IP
    const recentIpAttempts = await LoginAttempt.count({
      where: {
        ip_address: ip,
        successful: false,
        attempted_at: { [Op.gte]: oneHourAgo }
      }
    });
    
    // Блокируем, если больше 5 неудачных попыток для email
    if (recentEmailAttempts >= 5) {
      return {
        blocked: true,
        reason: 'email',
        attempts: recentEmailAttempts,
        waitTime: this.getWaitTime(recentEmailAttempts)
      };
    }
    
    // Блокируем, если больше 10 неудачных попыток с IP
    if (recentIpAttempts >= 10) {
      return {
        blocked: true,
        reason: 'ip',
        attempts: recentIpAttempts,
        waitTime: this.getWaitTime(recentIpAttempts)
      };
    }
    
    return { blocked: false };
  }
  
  /**
   * Получить время ожидания
   */
  getWaitTime(attempts) {
    if (attempts >= 10) return 60; // 60 минут
    if (attempts >= 5) return 15;   // 15 минут
    return 5;                         // 5 минут
  }
  
  /**
   * Записать попытку входа
   */
  async logAttempt(email, ip, successful, userId = null) {
    await LoginAttempt.create({
      email,
      ip_address: ip,
      successful,
      user_id: userId
    });
  }
  
  /**
   * Очистить успешные попытки после входа
   */
  async clearSuccessfulAttempts(email, ip) {
  }
}

module.exports = new SecurityService();