'use strict';

/**
 * Сид-данные для разработки: жанры, книги, пользователи, клубы.
 * Идемпотентен: повторный запуск не создаёт дубли.
 *
 * Запуск: DB_DRIVER=pglite node src/db/seed.js
 * (в режиме pglite данные живут в памяти процесса — для наполнения
 *  реальной БД используйте DATABASE_URL)
 */

require('dotenv').config({ quiet: true });

const bcrypt = require('bcrypt');
const { slugify } = require('../lib/slug');

const GENRES = [
  'Русская классика', 'Зарубежная классика', 'Современная проза', 'Фантастика',
  'Фэнтези', 'Детективы', 'Нон-фикшн', 'Биографии', 'Поэзия', 'Детская литература',
  'Психология', 'История', 'Научпоп', 'Ужасы', 'Романтика', 'Антиутопия',
  'Приключения', 'Мемуары', 'Философия', 'Бизнес'
];

const BOOKS = [
  ['Мастер и Маргарита', 'Михаил Булгаков', 1967, 480, 'Русская классика'],
  ['Преступление и наказание', 'Фёдор Достоевский', 1866, 672, 'Русская классика'],
  ['Война и мир', 'Лев Толстой', 1869, 1300, 'Русская классика'],
  ['Тихий Дон', 'Михаил Шолохов', 1940, 1600, 'Русская классика'],
  ['Доктор Живаго', 'Борис Пастернак', 1957, 560, 'Русская классика'],
  ['1984', 'Джордж Оруэлл', 1949, 320, 'Антиутопия'],
  ['Скотный двор', 'Джордж Оруэлл', 1945, 192, 'Антиутопия'],
  ['О дивный новый мир', 'Олдос Хаксли', 1932, 352, 'Антиутопия'],
  ['451° по Фаренгейту', 'Рэй Брэдбери', 1953, 256, 'Антиутопия'],
  ['Мы', 'Евгений Замятин', 1920, 288, 'Антиутопия'],
  ['Дюна', 'Фрэнк Герберт', 1965, 704, 'Фантастика'],
  ['Солярис', 'Станислав Лем', 1961, 288, 'Фантастика'],
  ['Пикник на обочине', 'Аркадий и Борис Стругацкие', 1972, 256, 'Фантастика'],
  ['Трудно быть богом', 'Аркадий и Борис Стругацкие', 1964, 288, 'Фантастика'],
  ['Гиперион', 'Дэн Симмонс', 1989, 640, 'Фантастика'],
  ['Тень горы', 'Грегори Дэвид Робертс', 2007, 736, 'Современная проза'],
  ['Шантарам', 'Грегори Дэвид Робертс', 2003, 864, 'Современная проза'],
  ['Щегол', 'Донна Тартт', 2013, 832, 'Современная проза'],
  ['Тайная история', 'Донна Тартт', 1992, 576, 'Современная проза'],
  ['Норвежский лес', 'Харуки Мураками', 1987, 384, 'Современная проза'],
  ['Кафка на пляже', 'Харуки Мураками', 2002, 512, 'Современная проза'],
  ['Бесы', 'Фёдор Достоевский', 1872, 768, 'Русская классика'],
  ['Идиот', 'Фёдор Достоевский', 1869, 640, 'Русская классика'],
  ['Анна Каренина', 'Лев Толстой', 1877, 864, 'Русская классика'],
  ['Гарри Поттер и философский камень', 'Джоан Роулинг', 1997, 432, 'Фэнтези'],
  ['Властелин колец', 'Джон Толкин', 1954, 1178, 'Фэнтези'],
  ['Хоббит', 'Джон Толкин', 1937, 320, 'Фэнтези'],
  ['Ведьмак. Последнее желание', 'Анджей Сапковский', 1993, 384, 'Фэнтези'],
  ['Имя ветра', 'Патрик Ротфусс', 2007, 736, 'Фэнтези'],
  ['Убийство в «Восточном экспрессе»', 'Агата Кристи', 1934, 288, 'Детективы'],
  ['Десять негритят', 'Агата Кристи', 1939, 288, 'Детективы'],
  ['Девушка с татуировкой дракона', 'Стиг Ларссон', 2005, 624, 'Детективы'],
  ['Шерлок Холмс. Собрание рассказов', 'Артур Конан Дойл', 1892, 900, 'Детективы'],
  ['Sapiens. Краткая история человечества', 'Юваль Ной Харари', 2011, 512, 'Нон-фикшн'],
  ['Homo Deus', 'Юваль Ной Харари', 2016, 496, 'Нон-фикшн'],
  ['Думай медленно… решай быстро', 'Даниэль Канеман', 2011, 656, 'Психология'],
  ['Поток. Психология оптимального переживания', 'Михай Чиксентмихайи', 1990, 464, 'Психология'],
  ['Как читать книги', 'Мортимер Адлер', 1940, 400, 'Нон-фикшн'],
  ['Думай как математик', 'Барбара Оакли', 2014, 320, 'Психология'],
  ['От нуля к единице', 'Питер Тиль', 2014, 240, 'Бизнес'],
  ['Lean Startup', 'Эрик Рис', 2011, 336, 'Бизнес'],
  ['Чёрный лебедь', 'Нассим Талеб', 2007, 528, 'Нон-фикшн'],
  ['Краткая история времени', 'Стивен Хокинг', 1988, 272, 'Научпоп'],
  ['Элегантная вселенная', 'Брайан Грин', 1999, 464, 'Научпоп'],
  ['Происхождение видов', 'Чарльз Дарвин', 1859, 480, 'Научпоп'],
  ['Сто лет одиночества', 'Габриэль Гарсиа Маркес', 1967, 480, 'Зарубежная классика'],
  ['Любовь во время чумы', 'Габриэль Гарсиа Маркес', 1985, 448, 'Зарубежная классика'],
  ['Имя розы', 'Умберто Эко', 1980, 640, 'Зарубежная классика'],
  ['Над пропастью во ржи', 'Джером Сэлинджер', 1951, 288, 'Зарубежная классика'],
  ['Великий Гэтсби', 'Фрэнсис Скотт Фицджеральд', 1925, 256, 'Зарубежная классика'],
  ['Стихотворения и поэмы', 'Александр Пушкин', 1837, 512, 'Поэзия'],
  ['Стихотворения', 'Анна Ахматова', 1966, 384, 'Поэзия'],
  ['Сияние', 'Стивен Кинг', 1977, 592, 'Ужасы'],
  ['Оно', 'Стивен Кинг', 1986, 1248, 'Ужасы'],
  ['Зелёная миля', 'Стивен Кинг', 1996, 432, 'Ужасы'],
  ['Гордость и предубеждение', 'Джейн Остин', 1813, 416, 'Романтика'],
  ['Джейн Эйр', 'Шарлотта Бронте', 1847, 512, 'Романтика'],
  ['Остров сокровищ', 'Роберт Льюис Стивенсон', 1883, 288, 'Приключения'],
  ['Двадцать тысяч льё под водой', 'Жюль Верн', 1870, 448, 'Приключения'],
  ['Мемуары гейши', 'Артур Голден', 1997, 512, 'Мемуары']
];

const DESCRIPTIONS = {
  default: 'Книга из каталога «Книгоманов». Описание добавим при наполнении — пока это демонстрационные данные.'
};

const COLLECTIONS = [
  ['Что читать, если давно не читал', 'Короткие и цепляющие книги, после которых снова хочется читать по вечерам.'],
  ['Антиутопии, которые сбываются слишком точно', 'Про то, как устроено давление: языком, комфортом и хорошими новостями.'],
  ['Наука без формул', 'Книги, после которых понятно, как учёные узнают то, что знают.'],
  ['Читать на ночь, чтобы уснуть', 'Медленная проза и короткие рассказы без резких поворотов.']
];

const AUTHORS_DEMO = [
  ['Михаил Булгаков', '1891–1940', 'Врач по образованию, писатель по призванию. Главный роман писал восемь лет и не увидел напечатанным.'],
  ['Лев Толстой', '1828–1910', 'Граф, артиллерист, учитель и один из самых неудобных людей своего века.'],
  ['Донна Тартт', 'род. 1963', 'Американская писательница, которая выпускает книгу раз в десять лет и каждый раз получает премии.'],
  ['Стивен Кинг', 'род. 1947', 'Умеет пугать не монстрами, а бытом: отелем, дорогой, семьёй, которая устала.'],
  ['Антон Чехов', '1860–1904', 'Врач, который лечил крестьян бесплатно и писал рассказы по вечерам.']
];

function coverFor(index) {
  return `covers/demo-${(index % 8) + 1}.svg`;
}

/**
 * Первый администратор для чистого продакшена.
 *
 * Демо-читателей на проде быть не должно: это чужие аккаунты с известным
 * паролем. Здесь создаётся ровно один админ, пароль — из ADMIN_PASSWORD,
 * иначе случайный, и печатается один раз.
 *
 * Запуск (см. docs/DEPLOY.md):
 *   DATABASE_URL=... ADMIN_EMAIL=... node -e "require('./src/db/seed').seedAdmin()"
 */
async function seedAdmin({ sequelize, models, email, password, name = 'Администратор', verbose = true } = {}) {
  // core — открытое внутри соединение, чтобы закрыть его после работы
  let core = null;
  if (!models) {
    const { openDatabase } = require('./open');
    const db = await openDatabase({ migrate: true, silent: true });
    models = db.models;
    core = db;
  }

  const finalEmail = String(email || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!finalEmail) throw new Error('нужен ADMIN_EMAIL: без адреса администратора не создать');

  const existing = await models.User.findOne({ where: { email: finalEmail } });
  if (existing) {
    if (verbose) console.log(`администратор ${finalEmail} уже есть, ничего не меняю`);
    if (core) await core.close();
    return { created: false, email: finalEmail };
  }

  const crypto = require('node:crypto');
  const finalPassword = String(password || process.env.ADMIN_PASSWORD || '')
    || crypto.randomBytes(12).toString('base64url');

  await models.User.create({
    email: finalEmail,
    name,
    passwordHash: await bcrypt.hash(finalPassword, 12),
    role: 'admin',
    emailVerifiedAt: new Date()
  });

  if (verbose) {
    console.log('Администратор создан:');
    console.log(`  e-mail: ${finalEmail}`);
    console.log(`  пароль: ${finalPassword}`);
    console.log('Сохрани пароль и смени его в /nastroyki после входа.');
  }

  if (core) await core.close();
  return { created: true, email: finalEmail, password: finalPassword };
}

async function seed({ sequelize, models, verbose = true }) {
  const {
    Genre, Book, BookGenre, User, LibraryEntry, Review, Club, ClubMember,
    ClubPost, ClubSchedule, Follow, Activity, Notification, Quote, ReadingGoal,
    Collection, CollectionBook, Author
  } = models;
  const log = (message) => { if (verbose) console.log(message); };

  // --- жанры ---
  const genreMap = new Map();
  for (const [index, name] of GENRES.entries()) {
    const [genre] = await Genre.findOrCreate({
      where: { slug: slugify(name, 'zhanr') },
      defaults: { name, slug: slugify(name, 'zhanr'), sortOrder: index }
    });
    genreMap.set(name, genre);
  }
  log(`жанры: ${genreMap.size}`);

  // --- книги ---
  let booksCreated = 0;
  const books = [];
  for (const [index, [title, author, year, pages, genreName]] of BOOKS.entries()) {
    const slug = slugify(`${author} ${title}`, `kniga-${index + 1}`);
    const [book, created] = await Book.findOrCreate({
      where: { slug },
      defaults: {
        slug,
        title,
        author,
        year,
        pages,
        description: DESCRIPTIONS.default,
        cover: coverFor(index)
      }
    });
    books.push(book);
    if (created) {
      booksCreated += 1;
      const genre = genreMap.get(genreName);
      if (genre) {
        await BookGenre.findOrCreate({ where: { bookId: book.id, genreId: genre.id } });
      }
    }
  }
  log(`книги: ${books.length} (создано ${booksCreated})`);

  // --- пользователи ---
  const hash = await bcrypt.hash('reader2026', 4);
  const usersData = [
    { name: 'Анна', email: 'anna@example.com', role: 'admin', trustLevel: 2 },
    { name: 'Борис', email: 'boris@example.com', role: 'moderator', trustLevel: 2 },
    { name: 'Вера', email: 'vera@example.com', role: 'user', trustLevel: 1 },
    { name: 'Глеб', email: 'gleb@example.com', role: 'user', trustLevel: 0 },
    { name: 'Дина', email: 'dina@example.com', role: 'user', trustLevel: 1 }
  ];

  const users = [];
  for (const data of usersData) {
    const [user] = await User.findOrCreate({
      where: { email: data.email },
      defaults: { ...data, passwordHash: hash, emailVerifiedAt: new Date() }
    });
    users.push(user);
  }
  log(`пользователи: ${users.length} (пароль у всех: reader2026)`);

  // --- полки ---
  const statuses = ['reading', 'read', 'want', 'dnf'];
  let entries = 0;
  for (const [userIndex, user] of users.entries()) {
    for (let i = 0; i < 8; i += 1) {
      const book = books[(userIndex * 7 + i) % books.length];
      const status = statuses[(userIndex + i) % statuses.length];
      const progress = status === 'read'
        ? book.pages
        : status === 'reading' ? Math.floor((book.pages || 300) * 0.4) : 0;

      const [, created] = await LibraryEntry.findOrCreate({
        where: { userId: user.id, bookId: book.id },
        defaults: {
          userId: user.id,
          bookId: book.id,
          status,
          progressPages: progress || 0,
          startedAt: status === 'want' ? null : new Date(),
          finishedAt: status === 'read' ? new Date() : null
        }
      });
      if (created) entries += 1;
    }
  }
  log(`записей на полках: ${entries}`);

  // --- рецензии ---
  let reviews = 0;
  for (const [userIndex, user] of users.entries()) {
    for (let i = 0; i < 3; i += 1) {
      const book = books[(userIndex * 5 + i * 3) % books.length];
      const [, created] = await Review.findOrCreate({
        where: { userId: user.id, bookId: book.id },
        defaults: {
          userId: user.id,
          bookId: book.id,
          // половинные шаги: 8 = 4 звезды, 9 = 4.5, 10 = 5
          rating: [8, 9, 10, 7, 6][(userIndex + i) % 5],
          title: 'Впечатления',
          body: `Демонстрационная рецензия на книгу «${book.title}». Здесь будет настоящий текст от пользователя.`,
          hasSpoilers: i === 2
        }
      });
      if (created) reviews += 1;
    }
  }
  log(`рецензии: ${reviews}`);

  // --- клубы ---
  const clubsData = [
    {
      name: 'Классика по средам',
      description: 'Читаем по одной главе в неделю и обсуждаем в четверг вечером.',
      bookIndex: 0
    },
    {
      name: 'Фантастика без границ',
      description: 'От Стругацких до Симмонса: что было и что будет.',
      bookIndex: 10
    },
    {
      name: 'Нон-фикшн клуб',
      description: 'Психология, экономика, наука — по делу и без воды.',
      bookIndex: 33
    }
  ];

  for (const [index, data] of clubsData.entries()) {
    const owner = users[index % users.length];
    const [club] = await Club.findOrCreate({
      where: { slug: slugify(data.name, `klub-${index + 1}`) },
      defaults: {
        slug: slugify(data.name, `klub-${index + 1}`),
        name: data.name,
        description: data.description,
        ownerId: owner.id,
        currentBookId: books[data.bookIndex]?.id || null,
        lastActivityAt: new Date()
      }
    });
    await ClubMember.findOrCreate({
      where: { clubId: club.id, userId: owner.id },
      defaults: { clubId: club.id, userId: owner.id, role: 'lead' }
    });
  }
  log(`клубы: ${clubsData.length}`);

  // --- социальная часть: подписки, лента, цитаты, цель, уведомления ---
  // Демо-данные должны показывать продукт «как есть»: пустая лента и ноль
  // подписок выглядят как недоделка, хотя код работает.
  let follows = 0;
  const followPairs = [[1, 0], [2, 0], [3, 1], [4, 2], [0, 4]];
  for (const [followerIndex, followingIndex] of followPairs) {
    const follower = users[followerIndex];
    const following = users[followingIndex];
    if (!follower || !following || follower.id === following.id) continue;
    const [, created] = await Follow.findOrCreate({
      where: { followerId: follower.id, followingId: following.id },
      defaults: { followerId: follower.id, followingId: following.id }
    });
    if (created) follows += 1;
  }
  log(`подписки: ${follows}`);

  // Лента: по несколько событий на человека, чтобы было что листать
  let activities = 0;
  for (const [userIndex, user] of users.entries()) {
    const shelfBooks = books.filter((book, index) => (index + userIndex) % 6 === 0).slice(0, 4);
    for (const [position, book] of shelfBooks.entries()) {
      const type = position % 2 === 0 ? 'shelf' : 'finished';
      await Activity.create({
        userId: user.id,
        type,
        bookId: book.id,
        createdAt: new Date(Date.now() - (position + userIndex) * 36 * 3600 * 1000),
        updatedAt: new Date()
      }).catch(() => null);
      activities += 1;
    }
  }
  log(`события ленты: ${activities}`);

  // Цитаты: короткие, до 300 знаков — как требует наша же валидация
  const quotesData = [
    'Страх — убийца разума. Страх — маленькая смерть, влекущая за собой полное уничтожение.',
    'Мы все в сточной канаве, но некоторые смотрят на звёзды.',
    'Свобода — это возможность сказать, что дважды два — четыре.',
    'Книга — это диалог, в котором читатель имеет право на последнее слово.'
  ];
  for (const [index, body] of quotesData.entries()) {
    const user = users[index % users.length];
    const book = books[(index * 11) % books.length];
    if (!book) continue;
    await Quote.findOrCreate({
      where: { userId: user.id, bookId: book.id },
      defaults: { userId: user.id, bookId: book.id, body, page: 20 + index * 13 }
    });
  }
  log(`цитаты: ${quotesData.length}`);

  // Цель на год у первого пользователя — чтобы статистика была не пустой
  const currentYear = new Date().getFullYear();
  await ReadingGoal.findOrCreate({
    where: { userId: users[0].id, year: currentYear },
    defaults: { userId: users[0].id, year: currentYear, targetBooks: 24 }
  });

  // Обсуждения и расписание в первом клубе: спойлер к главе 6 скрыт по умолчанию
  const firstClub = await Club.findOne({ where: { slug: slugify(clubsData[0].name, 'klub-1') } });
  if (firstClub) {
    const firstOwner = users[0];
    if (!(await ClubPost.findOne({ where: { clubId: firstClub.id } }))) {
      await ClubPost.create({
        clubId: firstClub.id,
        userId: firstOwner.id,
        body: 'Начинаем с первой главы. Читаем до воскресенья, обсуждаем впечатления без пересказа сюжета.',
        chapter: 1,
        hasSpoilers: false
      });
      await ClubPost.create({
        clubId: firstClub.id,
        userId: users[1].id,
        body: 'Дошёл до шестой главы: там сюжет делает резкий поворот, и это меняет всё отношение к герою.',
        chapter: 6,
        hasSpoilers: true
      });
      await Club.update(
        { postsCount: 2, membersCount: 3, lastActivityAt: new Date() },
        { where: { id: firstClub.id } }
      );
      await ClubMember.findOrCreate({
        where: { clubId: firstClub.id, userId: users[1].id },
        defaults: { clubId: firstClub.id, userId: users[1].id, role: 'moderator' }
      });
      await ClubMember.findOrCreate({
        where: { clubId: firstClub.id, userId: users[2].id },
        defaults: { clubId: firstClub.id, userId: users[2].id, role: 'member' }
      });
    }

    if (!(await ClubSchedule.findOne({ where: { clubId: firstClub.id } }))) {
      const today = new Date();
      for (let chapter = 1; chapter <= 4; chapter += 1) {
        const date = new Date(today.getTime() + chapter * 7 * 24 * 3600 * 1000);
        await ClubSchedule.create({
          clubId: firstClub.id,
          chapter,
          discussionOn: date.toISOString().slice(0, 10),
          note: chapter === 1 ? 'Знакомимся с героями' : ''
        });
      }
    }

    // Приветственное уведомление — иначе счётчик в шапке всегда ноль
    await Notification.findOrCreate({
      where: { userId: users[0].id, type: 'system', title: 'Добро пожаловать в «Книгоманы»' },
      defaults: {
        userId: users[0].id,
        type: 'system',
        title: 'Добро пожаловать в «Книгоманы»',
        body: 'Полка, цель на год и клубы уже ждут.',
        url: '/polka',
        isRead: false
      }
    });
  }

  // --- подборки: демо-версия для разработки (на проде их заливает content:load) ---
  let collectionsCreated = 0;
  for (const [index, [title, description]] of COLLECTIONS.entries()) {
    const slug = slugify(title, `podborka-${index + 1}`);
    const [collection, created] = await Collection.findOrCreate({
      where: { slug },
      defaults: { slug, title, description, sortOrder: index }
    });
    if (created) collectionsCreated += 1;

    // Пять книг из каталога, начиная со своей позиции: списки не повторяются
    const start = index * 13;
    for (let step = 0; step < 5; step += 1) {
      const book = books[(start + step) % books.length];
      if (!book) continue;
      await CollectionBook.findOrCreate({
        where: { collectionId: collection.id, bookId: book.id },
        defaults: { collectionId: collection.id, bookId: book.id, position: step }
      });
    }
  }
  log(`подборки: ${collectionsCreated}`);

  // --- авторы: только те, у кого действительно есть книги в каталоге ---
  let authorsCreated = 0;
  for (const [name, years, bio] of AUTHORS_DEMO) {
    const hasBooks = books.some((book) => book.author === name);
    if (!hasBooks) continue;
    const [, created] = await Author.findOrCreate({
      where: { slug: slugify(name, 'avtor') },
      defaults: { slug: slugify(name, 'avtor'), name, years, bio }
    });
    if (created) authorsCreated += 1;
  }
  log(`авторы: ${authorsCreated}`);

  return {
    genres: genreMap.size,
    books: books.length,
    users: users.length,
    reviews,
    follows,
    activities,
    collections: collectionsCreated,
    authors: authorsCreated
  };
}

module.exports = { seed, seedAdmin, GENRES, BOOKS };

if (require.main === module) {
  (async () => {
    const { openDatabase } = require('./open');
    // migrate: true — команда должна работать и на чистой папке
    const db = await openDatabase({ migrate: true });

    // Демо-данные поверх боевого каталога не нужны: если в базе уже
    // 300+ книг из content/, человек запускает сид случайно.
    const existing = await db.models.Book.count();
    if (existing > 120) {
      console.log(`В базе уже ${existing} книг — демо-данные не нужны, ничего не меняю.`);
      await db.close();
      process.exit(0);
    }

    const result = await seed({ sequelize: db.sequelize, models: db.models });
    console.log('Готово:', result);
    console.log('Вход: anna@example.com / reader2026');
    await db.close();
    process.exit(0);
  })().catch((error) => {
    console.error('Сид упал:', error.message);
    process.exit(1);
  });
}
