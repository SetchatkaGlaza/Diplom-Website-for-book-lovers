const sequelize = require('../config/database');
const bcrypt = require('bcrypt');
const { User, Genre, Book, Review, UserBook, ForumCategory } = require('../models');

const SALT_ROUNDS = 10;

async function seed() {
  try {
    console.log('🌱 НАЧИНАЕМ НАПОЛНЕНИЕ БАЗЫ ДАННЫХ...');
    console.log('=========================================');
    
    // Проверяем подключение
    await sequelize.authenticate();
    console.log('✅ Подключение к БД установлено');
    
    // ===== 1. ОЧИСТКА ТАБЛИЦ (в правильном порядке) =====
    console.log('\n🗑️  Очистка таблиц...');
    await sequelize.query('DELETE FROM "ForumSubscriptions" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "ForumPostLikes" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "ForumPosts" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "ForumTopics" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "ForumCategories" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "ReviewLikes" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "UserBooks" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "Reviews" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "Books" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "Genres" CASCADE;').catch(() => {});
    await sequelize.query('DELETE FROM "Users" CASCADE;').catch(() => {});
    console.log('✅ Таблицы очищены');
    
    // ===== 2. СОЗДАЁМ ПОЛЬЗОВАТЕЛЕЙ =====
    console.log('\n👥 Создание пользователей...');
    
    const adminPassword = await bcrypt.hash('admin123', SALT_ROUNDS);
    const userPassword = await bcrypt.hash('user123', SALT_ROUNDS);
    
    const users = await User.bulkCreate([
      {
        name: 'Администратор',
        email: 'admin@booklovers.ru',
        password_hash: adminPassword,
        role: 'admin',
        avatar: 'default-avatar.png',
        isBlocked: false,
        email_verified: true
      },
      {
        name: 'Иван Петров',
        email: 'ivan@example.com',
        password_hash: userPassword,
        role: 'user',
        avatar: 'default-avatar.png',
        isBlocked: false,
        email_verified: true
      },
      {
        name: 'Мария Сидорова',
        email: 'maria@example.com',
        password_hash: userPassword,
        role: 'user',
        avatar: 'default-avatar.png',
        isBlocked: false,
        email_verified: true
      },
      {
        name: 'Алексей Книголюбов',
        email: 'alex@example.com',
        password_hash: userPassword,
        role: 'moderator',
        avatar: 'default-avatar.png',
        isBlocked: false,
        email_verified: true
      },
      {
        name: 'Елена Виноградова',
        email: 'elena@example.com',
        password_hash: userPassword,
        role: 'user',
        avatar: 'default-avatar.png',
        isBlocked: false,
        email_verified: true
      }
    ]);
    console.log(`✅ Создано пользователей: ${users.length}`);
    
    // ===== 3. СОЗДАЁМ ЖАНРЫ =====
    console.log('\n📚 Создание жанров...');
    
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
      { name: 'Психология' },
      { name: 'Классика' },
      { name: 'Триллер' }
    ]);
    console.log(`✅ Создано жанров: ${genres.length}`);
    
    // ===== 4. СОЗДАЁМ КНИГИ =====
    console.log('\n📖 Создание книг...');
    
    const books = await Book.bulkCreate([
      {
        title: 'Властелин Колец: Братство Кольца',
        author: 'Дж.Р.Р. Толкин',
        description: 'Сказание о великом походе, о силе дружбы и самопожертвования, о борьбе добра со злом. Юный хоббит Фродо получает в наследство от своего дяди Бильбо волшебное кольцо, которое может сделать своего владельца повелителем мира.',
        year: 1954,
        pages: 540,
        publisher: 'АСТ',
        cover_image: 'lotr1.jpg',
        genre_id: genres[0].id,
        views_count: 15420,
        ratings_count: 0
      },
      {
        title: '1984',
        author: 'Джордж Оруэлл',
        description: 'Самый знаменитый роман-антиутопия XX века. Мир разделен на три тоталитарных государства. Главный герой работает в Министерстве правды и занимается переписыванием истории.',
        year: 1949,
        pages: 320,
        publisher: 'Эксмо',
        cover_image: '1984.jpg',
        genre_id: genres[1].id,
        views_count: 28900,
        ratings_count: 0
      },
      {
        title: 'Убийство в Восточном экспрессе',
        author: 'Агата Кристи',
        description: 'Знаменитый детектив Эркюль Пуаро оказывается в поезде, где происходит загадочное убийство. Все пассажиры имеют алиби, но Пуаро подозревает, что они что-то скрывают.',
        year: 1934,
        pages: 256,
        publisher: 'Азбука',
        cover_image: 'orient-express.jpg',
        genre_id: genres[2].id,
        views_count: 18750,
        ratings_count: 0
      },
      {
        title: 'Мастер и Маргарита',
        author: 'Михаил Булгаков',
        description: 'Великий роман, в котором переплетаются две сюжетные линии: визит сатаны в Москву 1930-х годов и история любви Мастера и Маргариты.',
        year: 1967,
        pages: 480,
        publisher: 'АСТ',
        cover_image: 'master.jpg',
        genre_id: genres[3].id,
        views_count: 32450,
        ratings_count: 0
      },
      {
        title: 'Гарри Поттер и философский камень',
        author: 'Дж.К. Роулинг',
        description: 'Мальчик, который выжил. Гарри Поттер узнает, что он волшебник, и попадает в школу чародейства и волшебства Хогвартс.',
        year: 1997,
        pages: 432,
        publisher: 'Махаон',
        cover_image: 'harry1.jpg',
        genre_id: genres[0].id,
        views_count: 45320,
        ratings_count: 0
      },
      {
        title: 'Преступление и наказание',
        author: 'Ф.М. Достоевский',
        description: 'Социально-философский роман о студенте Раскольникове, который решает убить старуху-процентщицу, чтобы проверить свою теорию о "сверхчеловеке".',
        year: 1866,
        pages: 672,
        publisher: 'Эксмо',
        cover_image: 'crime.jpg',
        genre_id: genres[3].id,
        views_count: 21560,
        ratings_count: 0
      },
      {
        title: 'Таинственный остров',
        author: 'Жюль Верн',
        description: 'Пятеро смельчаков бегут из плена на воздушном шаре и попадают на необитаемый остров. Используя свои знания и умения, они создают цивилизацию с нуля.',
        year: 1874,
        pages: 640,
        publisher: 'Лабиринт',
        cover_image: 'mysterious-island.jpg',
        genre_id: genres[4].id,
        views_count: 9870,
        ratings_count: 0
      },
      {
        title: 'Сияние',
        author: 'Стивен Кинг',
        description: 'Писатель Джек Торранс устраивается смотрителем в отдаленный отель на зиму. Вместе с семьей он оказывается отрезанным от мира. Но отель хранит страшные секреты.',
        year: 1977,
        pages: 512,
        publisher: 'АСТ',
        cover_image: 'shining.jpg',
        genre_id: genres[5].id,
        views_count: 15670,
        ratings_count: 0
      },
      {
        title: 'Граф Монте-Кристо',
        author: 'Александр Дюма',
        description: 'История моряка Эдмона Дантеса, который становится узником замка Иф, а затем выбирается и начинает свою месть тем, кто его предал.',
        year: 1844,
        pages: 1248,
        publisher: 'Азбука',
        cover_image: 'monte-cristo.jpg',
        genre_id: genres[4].id,
        views_count: 18900,
        ratings_count: 0
      },
      {
        title: 'Дюна',
        author: 'Фрэнк Герберт',
        description: 'Эпическая сага о пустынной планете Арракис, где добывают самую ценную субстанцию во Вселенной — пряность. Борьба за власть, экология и религия переплетаются в этом шедевре.',
        year: 1965,
        pages: 720,
        publisher: 'АСТ',
        cover_image: 'dune.jpg',
        genre_id: genres[1].id,
        views_count: 23450,
        ratings_count: 0
      },
      {
        title: '451 градус по Фаренгейту',
        author: 'Рэй Брэдбери',
        description: 'Антиутопия о мире, где книги запрещены и сжигаются пожарными. Главный герой — пожарный Гай Монтэг, который начинает сомневаться в правильности такой системы.',
        year: 1953,
        pages: 256,
        publisher: 'Эксмо',
        cover_image: 'fahrenheit.jpg',
        genre_id: genres[1].id,
        views_count: 16780,
        ratings_count: 0
      },
      {
        title: 'Мартин Иден',
        author: 'Джек Лондон',
        description: 'Роман о молодом моряке, который влюбляется в девушку из высшего общества и решает стать писателем, чтобы заслужить её любовь.',
        year: 1909,
        pages: 480,
        publisher: 'АСТ',
        cover_image: 'martin-eden.jpg',
        genre_id: genres[3].id,
        views_count: 12340,
        ratings_count: 0
      }
    ]);
    console.log(`✅ Создано книг: ${books.length}`);
    
    // ===== 5. СОЗДАЁМ РЕЦЕНЗИИ =====
    console.log('\n⭐ Создание рецензий...');
    
    const reviews = await Review.bulkCreate([
      {
        rating: 5,
        content: 'Гениальная книга! Читал уже 5 раз и каждый раз нахожу что-то новое. Толкин создал целый мир, в который хочется возвращаться снова и снова.',
        user_id: users[1].id,
        book_id: books[0].id,
        likes_count: 15,
        dislikes_count: 1,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Потрясающая антиутопия. Оруэлл будто предсказал будущее. Читается на одном дыхании. Актуально как никогда.',
        user_id: users[2].id,
        book_id: books[1].id,
        likes_count: 23,
        dislikes_count: 2,
        is_moderated: true
      },
      {
        rating: 4,
        content: 'Классический детектив с неожиданной развязкой. Агата Кристи как всегда на высоте. Пуаро великолепен.',
        user_id: users[3].id,
        book_id: books[2].id,
        likes_count: 8,
        dislikes_count: 0,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Любимая книга на все времена. Булгаков гений. Каждый раз открываю для себя новые смыслы.',
        user_id: users[1].id,
        book_id: books[3].id,
        likes_count: 31,
        dislikes_count: 3,
        is_moderated: true
      },
      {
        rating: 4,
        content: 'Хорошее начало серии. Мир Гарри Поттера затягивает с первых страниц.',
        user_id: users[2].id,
        book_id: books[4].id,
        likes_count: 12,
        dislikes_count: 1,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Тяжелая, но гениальная книга. Достоевский глубоко копает. Раскольников - сложный персонаж.',
        user_id: users[3].id,
        book_id: books[5].id,
        likes_count: 19,
        dislikes_count: 2,
        is_moderated: true
      },
      {
        rating: 4,
        content: 'Отличная приключенческая книга. Жюль Верн мастер описаний.',
        user_id: users[1].id,
        book_id: books[6].id,
        likes_count: 5,
        dislikes_count: 0,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Стивен Кинг - король ужасов. "Сияние" пугает не монстрами, а атмосферой безумия.',
        user_id: users[2].id,
        book_id: books[7].id,
        likes_count: 17,
        dislikes_count: 1,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Шедевр Дюма! Читал взахлеб, не мог оторваться. История мести и любви.',
        user_id: users[4].id,
        book_id: books[8].id,
        likes_count: 14,
        dislikes_count: 0,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Дюна - это не просто книга, это целая вселенная. Обязательно к прочтению!',
        user_id: users[1].id,
        book_id: books[9].id,
        likes_count: 22,
        dislikes_count: 1,
        is_moderated: true
      },
      {
        rating: 5,
        content: 'Брэдбери гениален. Книга заставляет задуматься о ценности знаний.',
        user_id: users[2].id,
        book_id: books[10].id,
        likes_count: 18,
        dislikes_count: 0,
        is_moderated: true
      }
    ]);
    console.log(`✅ Создано рецензий: ${reviews.length}`);
    
    // ===== 6. ОБНОВЛЯЕМ РЕЙТИНГИ КНИГ =====
    console.log('\n📊 Обновление рейтингов книг...');
    
    for (const book of books) {
      const bookReviews = await Review.findAll({
        where: { book_id: book.id, is_moderated: true },
        attributes: ['rating']
      });
      
      if (bookReviews.length > 0) {
        const sum = bookReviews.reduce((acc, r) => acc + r.rating, 0);
        const avg = sum / bookReviews.length;
        await book.update({ 
          ratings_count: bookReviews.length,
          average_rating: avg 
        });
      }
    }
    console.log('✅ Рейтинги книг обновлены');
    
    // ===== 7. СОЗДАЁМ КАТЕГОРИИ ФОРУМА =====
    console.log('\n💬 Создание категорий форума...');
    
    const forumCategories = await ForumCategory.bulkCreate([
      {
        name: 'Общие обсуждения',
        description: 'Здесь можно обсуждать любые темы, связанные с книгами и чтением',
        icon: 'fa-comments',
        sort_order: 1,
        created_by: users[0].id,
        is_active: true
      },
      {
        name: 'Книжные рекомендации',
        description: 'Делитесь рекомендациями и ищите новые книги для чтения',
        icon: 'fa-bookmark',
        sort_order: 2,
        created_by: users[0].id,
        is_active: true
      },
      {
        name: 'Рецензии и отзывы',
        description: 'Обсуждайте рецензии на книги, делитесь мнениями',
        icon: 'fa-star',
        sort_order: 3,
        created_by: users[0].id,
        is_active: true
      },
      {
        name: 'Жанровые клубы',
        description: 'Фэнтези, детективы, классика, научная фантастика и другие жанры',
        icon: 'fa-tags',
        sort_order: 4,
        created_by: users[0].id,
        is_active: true
      },
      {
        name: 'Помощь и поддержка',
        description: 'Вопросы по работе сайта, предложения и пожелания',
        icon: 'fa-life-ring',
        sort_order: 5,
        created_by: users[0].id,
        is_active: true
      }
    ]);
    console.log(`✅ Создано категорий форума: ${forumCategories.length}`);
    
    // ===== 8. СОЗДАЁМ ПРИМЕРЫ ТЕМ НА ФОРУМЕ =====
    console.log('\n📝 Создание примеров тем форума...');
    
    const { ForumTopic, ForumPost } = require('../models');
    
    const topics = await ForumTopic.bulkCreate([
      {
        category_id: forumCategories[0].id,
        user_id: users[1].id,
        title: 'Какая книга изменила вашу жизнь?',
        content: 'Расскажите о книге, которая повлияла на ваше мировоззрение или помогла в трудной ситуации.',
        slug: 'kakaya-kniga-izmenila-vashu-zhizn',
        views: 156,
        replies_count: 3,
        is_moderated: true,
        last_reply_user_id: users[2].id,
        last_reply_at: new Date()
      },
      {
        category_id: forumCategories[0].id,
        user_id: users[2].id,
        title: 'Как вы выбираете следующую книгу?',
        content: 'Поделитесь своими методами выбора книг: по рекомендациям, по обложке, по рейтингам?',
        slug: 'kak-vy-vybiraete-sleduyushchuyu-knigu',
        views: 98,
        replies_count: 2,
        is_moderated: true,
        last_reply_user_id: users[1].id,
        last_reply_at: new Date()
      },
      {
        category_id: forumCategories[1].id,
        user_id: users[3].id,
        title: 'Что почитать из современной фантастики?',
        content: 'Посоветуйте хорошие книги последних лет в жанре научной фантастики или фэнтези.',
        slug: 'chto-pochitat-iz-sovremennoy-fantastiki',
        views: 234,
        replies_count: 5,
        is_moderated: true,
        last_reply_user_id: users[4].id,
        last_reply_at: new Date()
      }
    ]);
    
    // Создаём сообщения в темах
    await ForumPost.bulkCreate([
      {
        topic_id: topics[0].id,
        user_id: users[1].id,
        content: 'Для меня такой книгой стал "Мастер и Маргарита" Булгакова. После прочтения я по-новому взглянул на многие вещи.',
        is_moderated: true
      },
      {
        topic_id: topics[0].id,
        user_id: users[2].id,
        content: 'А для меня - "Маленький принц" Экзюпери. Кажется, что это детская книга, но она открывается по-новому с каждым прочтением.',
        is_moderated: true
      },
      {
        topic_id: topics[0].id,
        user_id: users[3].id,
        content: '1984 Оруэлла. Страшно, но очень важно для понимания современного мира.',
        is_moderated: true
      },
      {
        topic_id: topics[1].id,
        user_id: users[2].id,
        content: 'Обычно я смотрю рекомендации на Goodreads и читаю отзывы. Также часто ориентируюсь на любимых авторов.',
        is_moderated: true
      },
      {
        topic_id: topics[1].id,
        user_id: users[4].id,
        content: 'А я люблю просто бродить по книжному магазину и выбирать по обложке и аннотации. Так я нашёл много интересных книг!',
        is_moderated: true
      },
      {
        topic_id: topics[2].id,
        user_id: users[3].id,
        content: 'Очень рекомендую "Проект Аве Мария" Энди Вейера. Отличная научная фантастика с юмором.',
        is_moderated: true
      },
      {
        topic_id: topics[2].id,
        user_id: users[1].id,
        content: 'Согласен! И ещё "Дети времени" Адриана Чайковски - шедевр!',
        is_moderated: true
      }
    ]);
    
    console.log(`✅ Создано тем: ${topics.length}`);
    console.log('✅ Создано сообщений: 7');
    
    // ===== ИТОГИ =====
    console.log('\n=========================================');
    console.log('🎉 БАЗА ДАННЫХ УСПЕШНО НАПОЛНЕНА!');
    console.log('=========================================');
    console.log('\n📊 СТАТИСТИКА:');
    console.log(`   👤 Пользователей: ${users.length}`);
    console.log(`   📚 Книг: ${books.length}`);
    console.log(`   🏷️  Жанров: ${genres.length}`);
    console.log(`   ⭐ Рецензий: ${reviews.length}`);
    console.log(`   💬 Категорий форума: ${forumCategories.length}`);
    console.log(`   📝 Тем форума: ${topics.length}`);
    console.log(`   💬 Сообщений: 7`);
    console.log('\n🔑 ДАННЫЕ ДЛЯ ВХОДА:');
    console.log('   Администратор: admin@booklovers.ru / admin123');
    console.log('   Пользователь:  ivan@example.com / user123');
    console.log('   Модератор:     alex@example.com / user123');
    console.log('\n=========================================');
    
  } catch (error) {
    console.error('❌ ОШИБКА:', error);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

seed();