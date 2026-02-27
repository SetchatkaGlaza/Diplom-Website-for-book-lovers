const { Notification, User } = require('../models');

async function checkNotifications() {
  try {
    console.log('🔍 Проверка системы уведомлений...\n');
    
    // Проверяем, есть ли таблица
    const tableExists = await Notification.sequelize.getQueryInterface().showAllTables();
    console.log('📊 Таблицы в БД:', tableExists);
    
    // Считаем количество уведомлений
    const total = await Notification.count();
    console.log(`📊 Всего уведомлений в БД: ${total}`);
    
    // Проверяем по пользователям
    const users = await User.findAll({ attributes: ['id', 'name'] });
    
    for (const user of users) {
      const count = await Notification.count({ where: { user_id: user.id } });
      const unread = await Notification.count({ where: { user_id: user.id, is_read: false } });
      
      console.log(`👤 ${user.name} (ID: ${user.id}): всего ${count}, непрочитано ${unread}`);
    }
    
    // Показываем последние 5 уведомлений
    const lastNotifications = await Notification.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5,
      include: [{ model: User, as: 'user', attributes: ['name'] }]
    });
    
    if (lastNotifications.length > 0) {
      console.log('\n📨 Последние уведомления:');
      lastNotifications.forEach(n => {
        console.log(`   [${n.createdAt.toLocaleString()}] ${n.user?.name}: ${n.title} - ${n.message.substring(0, 50)}...`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

checkNotifications();