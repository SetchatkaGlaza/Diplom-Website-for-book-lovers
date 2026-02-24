const sequelize = require('../config/database');
const { User, Genre, Book, Review } = require('../models');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

async function seed() {
  try {
    console.log('🌱 Начинаем наполнение базы данных...');
    
    // Проверяем подключение
    await sequelize.authenticate();
    console.log('Подключение к базе данных прошло успешно!');
    
    // Очищаем таблицы (в правильном порядке из-за внешних ключей)
    await Review.destroy({ where: {}, force: true });
    await Book.destroy({ where: {}, force: true });
    await Genre.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });
    
    console.log('✅ Таблицы очищены');
    
    // 1. Создаём пользователей
    const users = await User.bulkCreate([
      {
        name: 'Администратор',
        email: 'admin@booklovers.ru',
        password_hash: await bcrypt.hash('admin123', SALT_ROUNDS),
        role: 'admin',
        avatar: 'default-avatar.png'
      },
      {
        name: 'Иван Петров',
        email: 'ivan@example.com',
        password_hash: await bcrypt.hash('password123', SALT_ROUNDS),
        role: 'user',
        avatar: 'default-avatar.png'
      },
      {
        name: 'Мария Сидорова',
        email: 'maria@example.com',
        password_hash: await bcrypt.hash('password123', SALT_ROUNDS),
        role: 'user',
        avatar: 'default-avatar.png'
      },
      {
        name: 'Алексей Книголюбов',
        email: 'alex@example.com',
        password_hash: await bcrypt.hash('password123', SALT_ROUNDS),
        role: 'moderator',
        avatar: 'default-avatar.png'
      }
    ]);
    
    console.log(`✅ Создано пользователей: ${users.length}`);
    
    // 2. Создаём жанры
    const genres = await Genre.bulkCreate([
      { name: 'Фэнтези' },
      { name: 'Научная фантастика' },
      { name: 'Детектив' },
      { name: 'Роман' },
      { name: 'Приключения' },
      { name: 'Ужасы' },
      { name: 'Поэзия' },
      { name: 'Биография' },
      { name: 'История' },
      { name: 'Психология' }
    ]);
    
    console.log(`✅ Создано жанров: ${genres.length}`);
    
    // 3. Создаём книги
    const books = await Book.bulkCreate([
      {
        title: 'Властелин Колец: Братство Кольца',
        author: 'Дж.Р.Р. Толкин',
        description: 'Сказание о великом походе, о силе дружбы и самопожертвования, о борьбе добра со злом, о победе света над тьмой. Юный хоббит Фродо получает в наследство от своего дяди Бильбо волшебное кольцо, которое может сделать своего владельца повелителем мира.',
        year: 1954,
        pages: 540,
        publisher: 'АСТ',
        cover_image: 'lotr1.jpg',
        genre_id: genres[0].id, // Фэнтези
        views_count: 15420
      },
      {
        title: '1984',
        author: 'Джордж Оруэлл',
        description: 'Самый знаменитый роман-антиутопия XX века. Мир разделен на три тоталитарных государства. Главный герой работает в Министерстве правды и занимается переписыванием истории. Но однажды он влюбляется и начинает сомневаться в правильности системы.',
        year: 1949,
        pages: 320,
        publisher: 'Эксмо',
        cover_image: '1984.jpg',
        genre_id: genres[1].id, // Научная фантастика
        views_count: 28900
      },
      {
        title: 'Убийство в Восточном экспрессе',
        author: 'Агата Кристи',
        description: 'Знаменитый детектив Эркюль Пуаро оказывается в поезде, где происходит загадочное убийство. Все пассажиры имеют алиби, но Пуаро подозревает, что они что-то скрывают. Классический детектив с неожиданной развязкой.',
        year: 1934,
        pages: 256,
        publisher: 'Азбука',
        cover_image: 'orient-express.jpg',
        genre_id: genres[2].id, // Детектив
        views_count: 18750
      },
      {
        title: 'Мастер и Маргарита',
        author: 'Михаил Булгаков',
        description: 'Великий роман, в котором переплетаются две сюжетные линии: визит сатаны в Москву 1930-х годов и история любви Мастера и Маргариты. Философская притча о добре и зле, о творчестве и любви.',
        year: 1967,
        pages: 480,
        publisher: 'АСТ',
        cover_image: 'master.jpg',
        genre_id: genres[3].id, // Роман
        views_count: 32450
      },
      {
        title: 'Гарри Поттер и философский камень',
        author: 'Дж.К. Роулинг',
        description: 'Мальчик, который выжил. Гарри Поттер узнает, что он волшебник, и попадает в школу чародейства и волшебства Хогвартс. Первый год обучения приносит ему верных друзей и опасного врага.',
        year: 1997,
        pages: 432,
        publisher: 'Махаон',
        cover_image: 'harry1.jpg',
        genre_id: genres[0].id, // Фэнтези
        views_count: 45320
      },
      {
        title: 'Преступление и наказание',
        author: 'Ф.М. Достоевский',
        description: 'Социально-философский роман о студенте Раскольникове, который решает убить старуху-процентщицу, чтобы проверить свою теорию о "сверхчеловеке". Но после преступления его мучает совесть.',
        year: 1866,
        pages: 672,
        publisher: 'Эксмо',
        cover_image: 'crime.jpg',
        genre_id: genres[3].id, // Роман
        views_count: 21560
      },
      {
        title: 'Таинственный остров',
        author: 'Жюль Верн',
        description: 'Пятеро смельчаков бегут из плена на воздушном шаре и попадают на необитаемый остров. Используя свои знания и умения, они создают цивилизацию с нуля, не подозревая, что остров хранит тайну.',
        year: 1874,
        pages: 640,
        publisher: 'Лабиринт',
        cover_image: 'mysterious-island.jpg',
        genre_id: genres[4].id, // Приключения
        views_count: 9870
      },
      {
        title: 'Сияние',
        author: 'Стивен Кинг',
        description: 'Писатель Джек Торранс устраивается смотрителем в отдаленный отель на зиму. Вместе с семьей он оказывается отрезанным от мира. Но отель хранит страшные секреты, которые начинают влиять на реальность.',
        year: 1977,
        pages: 512,
        publisher: 'АСТ',
        cover_image: 'shining.jpg',
        genre_id: genres[5].id, // Ужасы
        views_count: 15670
      }
    ]);
    
    console.log(`✅ Создано книг: ${books.length}`);
    
    // 4. Создаём рецензии
    const reviews = await Review.bulkCreate([
      {
        rating: 5,
        content: 'Гениальная книга! Читал уже 5 раз и каждый раз нахожу что-то новое. Толкин создал целый мир, в который хочется возвращаться снова и снова. Обязательно к прочтению всем фанатам фэнтези.',
        user_id: users[1].id, // Иван
        book_id: books[0].id, // Властелин Колец
        likes_count: 15,
        dislikes_count: 1,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Потрясающая антиутопия. Оруэлл будто предсказал будущее. Читается на одном дыхании, хотя после прочтения остается тяжелое послевкусие. Актуально как никогда.',
        user_id: users[2].id, // Мария
        book_id: books[1].id, // 1984
        likes_count: 23,
        dislikes_count: 2,
        is_moderated: true
      },
      {
        rating: 4,
        content: 'Классический детектив с неожиданной развязкой. Агата Кристи как всегда на высоте. Пуаро великолепен. Рекомендую всем любителям жанра.',
        user_id: users[3].id, // Алексей
        book_id: books[2].id, // Убийство в Восточном экспрессе
        likes_count: 8,
        dislikes_count: 0,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Любимая книга на все времена. Булгаков гений. Каждый раз открываю для себя новые смыслы. Маргарита и Воланд стали культовыми персонажами.',
        user_id: users[1].id, // Иван
        book_id: books[3].id, // Мастер и Маргарита
        likes_count: 31,
        dislikes_count: 3,
        is_moderated: true
      },
      {
        rating: 4,
        content: 'Хорошее начало серии. Для детей самое то, но и взрослым будет интересно. Мир Гарри Поттера затягивает с первых страниц.',
        user_id: users[2].id, // Мария
        book_id: books[4].id, // Гарри Поттер
        likes_count: 12,
        dislikes_count: 1,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Тяжелая, но гениальная книга. Достоевский глубоко копает. Раскольников - сложный персонаж, которому сочувствуешь, несмотря на его преступление.',
        user_id: users[3].id, // Алексей
        book_id: books[5].id, // Преступление и наказание
        likes_count: 19,
        dislikes_count: 2,
        is_moderated: true
      },
      {
        rating: 4,
        content: 'Отличная приключенческая книга. Жюль Верн мастер описаний. Интересно читать про то, как герои выживают и строят цивилизацию с нуля.',
        user_id: users[1].id, // Иван
        book_id: books[6].id, // Таинственный остров
        likes_count: 5,
        dislikes_count: 0,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Стивен Кинг - король ужасов. "Сияние" пугает не монстрами, а атмосферой безумия. Очень психологично. Фильм тоже хорош, но книга лучше.',
        user_id: users[2].id, // Мария
        book_id: books[7].id, // Сияние
        likes_count: 17,
        dislikes_count: 1,
        is_moderated: true
      }
    ]);
    
    console.log(`✅ Создано рецензий: ${reviews.length}`);
    
    console.log('🎉 База данных успешно наполнена!');
    
  } catch (error) {
    console.error('❌ Ошибка при наполнении базы:', error);
  } finally {
    process.exit(0);
  }
}

// Запускаем сиды
seed();