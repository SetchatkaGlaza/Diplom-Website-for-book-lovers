'use strict';

/**
 * Переменные окружения для тестов.
 * Должен подключаться ДО моделей: конфиг читает process.env при импорте.
 */
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.DB_LOGGING = 'false';
process.env.MAIL_FROM = 'Книгоманы <test@example.com>';
process.env.RESEND_API_KEY = '';
process.env.SMTP_HOST = '';
