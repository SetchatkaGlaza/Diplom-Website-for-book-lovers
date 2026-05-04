# Diplom-Website-for-book-lovers
Creation of a thesis project on the topic: Website development for book lovers. The goal: To learn and publish the finished product online. The repository was created for version tracking, execution control, and ease of development.

## Настройка Cloudinary (аватарки и обложки)

### 1) Переменные окружения
Добавь в `.env`:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

> В проекте загрузка переведена на **signed upload через Cloudinary SDK**, поэтому `upload_preset` для серверных загрузок не обязателен.

### 2) Проверка Cloudinary аккаунта
- Cloud name должен совпадать с `CLOUDINARY_CLOUD_NAME`.
- API Key/Secret должны быть активными и без пробелов/кавычек.
- В Cloudinary Console проверь, что аккаунт не заблокирован по лимитам.

### 3) Как теперь работает загрузка
- Multer использует `memoryStorage`.
- `sharp` подготавливает аватар.
- Файл отправляется в Cloudinary через `cloudinary.uploader.upload_stream`.
- В БД сохраняются `avatar` (secure URL) и `avatar_public_id`.

### 4) Почему была ошибка `400` от Cloudinary
Типовые причины:
- неверные `cloud_name` / `api_key` / `api_secret`;
- попытка unsigned-загрузки с неподходящим preset;
- preset ограничивает `folder`/`public_id`/transformations;
- неправильный тип файла.

В этом репозитории устранён риск с unsigned preset: сервер теперь грузит signed-запросом через SDK.

### 5) 404 на `/images/avatars/...`
Если пользователь уже загружал аватар в Cloudinary, но в старой логике URL строился как локальный путь, получался 404.
Теперь, если есть `avatar_public_id`, URL строится через Cloudinary.

### 6) Production-хостинг
Обязательно:
- `NODE_ENV=production`
- `SESSION_SECRET` длинный случайный
- включить persistent session store (Redis/Postgres), иначе warning `MemoryStore is not designed for production` корректный.

Рекомендуется:
- Хранить `public/images/avatars/default-avatar.png` как fallback.
- Подключить удаление старых аватаров по `avatar_public_id` (уже поддержано через Cloudinary destroy).
