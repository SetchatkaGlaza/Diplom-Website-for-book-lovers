const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const EmailChangeRequest = sequelize.define('EmailChangeRequest', {
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  current_email: {
    type: DataTypes.STRING(254),
    allowNull: false
  },
  new_email: {
    type: DataTypes.STRING(254),
    allowNull: false
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    allowNull: false,
    defaultValue: 'pending'
  },
  admin_note: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  resolved_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'email_change_requests',
  timestamps: true
});

module.exports = EmailChangeRequest;
