const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LoginAttempt = sequelize.define('LoginAttempt', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  user_id: { // Добавим ссылку на пользователя (если известен)
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  blocked_until: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_attempt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  timestamps: true,
  tableName: 'login_attempts',
  indexes: [
    {
      unique: true,
      fields: ['ip_address', 'email']
    }
  ]
});

module.exports = LoginAttempt;