const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/database');

const MAX_ADMINS = 5;

function getMaxAdminsErrorMessage() {
  return `На сайте может быть не больше ${MAX_ADMINS} администраторов`;
}

async function countAdmins(transaction) {
  return User.count({
    where: { role: 'admin' },
    transaction
  });
}

async function assertAdminSlotsAvailable(adminsToAdd, transaction) {
  if (adminsToAdd <= 0) {
    return;
  }

  const adminsCount = await countAdmins(transaction);

  if (adminsCount + adminsToAdd > MAX_ADMINS) {
    throw new Error(getMaxAdminsErrorMessage());
  }
}

const User = sequelize.define('User', {
  // id создастся автоматически
  name: {
    type: DataTypes.STRING,
    allowNull: false, // обязательно для заполнения
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, // email должен быть уникальным
    validate: {
      isEmail: true, // проверка, что это email
    },
  },
  password_hash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('user', 'admin', 'moderator'),
    defaultValue: 'user', // по умолчанию обычный пользователь
  },
  avatar: {
    type: DataTypes.STRING,
    defaultValue: 'default-avatar.png',
  },
  // НОВОЕ ПОЛЕ: публичный ID в Cloudinary (для удаления старого файла)
  avatar_public_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '',
  },
  isBlocked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  blocked_until: {
    type: DataTypes.DATE,
    allowNull: true
  },
  email_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  email_verification_token: {
    type: DataTypes.STRING,
    allowNull: true
  },
  admin_appointed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  admin_appointed_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  admin_appointment_reason: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  // Добавит поля createdAt и updatedAt автоматически
  timestamps: true,
  hooks: {
    async beforeSave(user, options) {
      if (!user.changed('role') || user.role !== 'admin' || user.previous('role') === 'admin') {
        return;
      }

      await assertAdminSlotsAvailable(1, options.transaction);
    },

    async beforeBulkCreate(users, options) {
      const newAdminsCount = users.filter((user) => user.role === 'admin').length;
      await assertAdminSlotsAvailable(newAdminsCount, options.transaction);
    },

    async beforeBulkUpdate(options) {
      if (!options.attributes || options.attributes.role !== 'admin') {
        return;
      }

      const targetNonAdminsCount = await User.count({
        where: {
          [Op.and]: [
            options.where || {},
            { role: { [Op.ne]: 'admin' } }
          ]
        },
        transaction: options.transaction
      });

      await assertAdminSlotsAvailable(targetNonAdminsCount, options.transaction);
    }
  }
});

User.MAX_ADMINS = MAX_ADMINS;
User.getMaxAdminsErrorMessage = getMaxAdminsErrorMessage;
User.countAdmins = countAdmins;

module.exports = User;