const {Sequelize} = require('sequelize');
require('dotenv').config(); // Загружаем переменные из .env

// Создаем подключение к базе данных
const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
{
    host: process.env.DB_HOST, // Хост(localhost)
    host: process.env.DB_PORT, // Порт (5432)
    dialect: 'postgres', // тип БД
    logging: false, // Выводить/невыводить SQL запросы в консоль.
}
);

// Проверка подключения
const testConnection = async () => {
    try {
        await sequelize.authenticate();
        console.log('Подключение к базе данных прошло успешно!');
    }
    catch (error) {
        console.error('Ошибка подключения к базе данных', error);
    }
};

testConnection();

module.exports = sequelize;