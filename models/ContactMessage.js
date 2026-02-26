const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ContactMessage = sequelize.define('ContactMessage', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      len: [2, 100]
    }
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  subject: {
    type: DataTypes.STRING(200),
    allowNull: false,
    defaultValue: 'Новое сообщение с сайта'
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      len: [10, 5000]
    }
  },
  // Статусы сообщения
  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  is_replied: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  is_archived: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  // Ответ администратора
  reply_message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  reply_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // Кто ответил (ID администратора)
  replied_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  // Заметки администратора (только для внутреннего использования)
  admin_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // IP отправителя (для безопасности)
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  // User agent (для аналитики)
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  timestamps: true, // создаст createdAt и updatedAt
  indexes: [
    {
      fields: ['is_read']
    },
    {
      fields: ['is_replied']
    },
    {
      fields: ['createdAt']
    },
    {
      fields: ['email']
    }
  ]
});

module.exports = ContactMessage;