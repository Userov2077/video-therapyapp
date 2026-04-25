const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const createTablesSQL = `
-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('client', 'psychologist')),
    specialization TEXT,
    experience TEXT,
    about TEXT,
    price INTEGER DEFAULT 0,
    topics JSONB DEFAULT '[]',
    schedule JSONB DEFAULT '{}',
    certificates JSONB DEFAULT '[]',
    rating REAL DEFAULT 0,
    avatar TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    appointments JSONB DEFAULT '[]',
    clients JSONB DEFAULT '[]',
    notifications JSONB DEFAULT '[]',
    unread_counts JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    author_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    image TEXT,
    video TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY,
    post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    from_user TEXT REFERENCES users(id) ON DELETE CASCADE,
    to_user TEXT REFERENCES users(id) ON DELETE CASCADE,
    text TEXT,
    image TEXT,
    voice TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    psychologist_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    psychologist_name TEXT,
    client_name TEXT,
    date TEXT,
    time TEXT,
    room_id TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed')),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    url TEXT,
    from_user TEXT,
    to_user TEXT,
    room_id TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    psychologist_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    due_date TEXT,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    psychologist_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    client_name TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    text TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    psychologist_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    content TEXT,
    attachment TEXT,
    attachment_type TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    follower_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    following_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS certificates (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    image TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
`;

async function migrate() {
    console.log('📦 Создаю таблицы...');
    await pool.query(createTablesSQL);
    console.log('✅ Таблицы созданы (или уже существуют)');

    const dataPath = './data/';
    const files = ['users', 'posts', 'likes', 'comments', 'messages', 'appointments', 'recordings', 'tasks', 'reviews', 'notes', 'subscriptions', 'certificates'];
    
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(`${dataPath}${file}.json`, 'utf8'));
            if (data.length === 0) continue;
            
            if (file === 'users') {
                for (const u of data) {
                    await pool.query(
                        `INSERT INTO users (id, full_name, email, phone, password, role, specialization, experience, about, price, topics, schedule, certificates, rating, avatar, created_at, appointments, clients, notifications, unread_counts)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                         ON CONFLICT (id) DO NOTHING`,
                        [u.id, u.fullName, u.email, u.phone, u.password, u.role, u.specialization, u.experience, u.about, u.price, JSON.stringify(u.topics), JSON.stringify(u.schedule), JSON.stringify(u.certificates), u.rating, u.avatar, u.createdAt, JSON.stringify(u.appointments), JSON.stringify(u.clients), JSON.stringify(u.notifications), JSON.stringify(u.unreadCounts)]
                    );
                }
            } else if (file === 'posts') {
                for (const p of data) {
                    await pool.query(
                        `INSERT INTO posts (id, author_id, text, image, video, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
                        [p.id, p.authorId, p.text, p.image, p.video, p.createdAt]
                    );
                }
            } else if (file === 'likes') {
                for (const l of data) {
                    await pool.query(
                        `INSERT INTO likes (id, post_id, user_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
                        [l.id, l.postId, l.userId, l.createdAt]
                    );
                }
            } else if (file === 'comments') {
                for (const c of data) {
                    await pool.query(
                        `INSERT INTO comments (id, post_id, author_id, text, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
                        [c.id, c.postId, c.authorId, c.text, c.createdAt]
                    );
                }
            } else if (file === 'messages') {
                for (const m of data) {
                    await pool.query(
                        `INSERT INTO messages (id, from_user, to_user, text, image, voice, is_read, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
                        [m.id, m.from, m.to, m.text, m.image, m.voice, m.isRead || false, m.createdAt]
                    );
                }
            } else if (file === 'appointments') {
                for (const a of data) {
                    await pool.query(
                        `INSERT INTO appointments (id, psychologist_id, client_id, psychologist_name, client_name, date, time, room_id, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
                        [a.id, a.psychologistId, a.clientId, a.psychologistName, a.clientName, a.date, a.time, a.roomId, a.status, a.createdAt]
                    );
                }
            } else if (file === 'recordings') {
                for (const r of data) {
                    await pool.query(
                        `INSERT INTO recordings (id, url, from_user, to_user, room_id, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
                        [r.id, r.url, r.from, r.to, r.roomId, r.createdAt]
                    );
                }
            } else if (file === 'tasks') {
                for (const t of data) {
                    await pool.query(
                        `INSERT INTO tasks (id, psychologist_id, text, due_date, completed, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
                        [t.id, t.psychologistId, t.text, t.dueDate, t.completed, t.createdAt]
                    );
                }
            } else if (file === 'reviews') {
                for (const r of data) {
                    await pool.query(
                        `INSERT INTO reviews (id, psychologist_id, client_id, client_name, rating, text, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
                        [r.id, r.psychologistId, r.clientId, r.clientName, r.rating, r.text, r.createdAt]
                    );
                }
            } else if (file === 'notes') {
                for (const n of data) {
                    await pool.query(
                        `INSERT INTO notes (id, psychologist_id, title, content, attachment, attachment_type, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
                        [n.id, n.psychologistId, n.title, n.content, n.attachment, n.attachmentType, n.createdAt]
                    );
                }
            } else if (file === 'subscriptions') {
                for (const s of data) {
                    await pool.query(
                        `INSERT INTO subscriptions (id, follower_id, following_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
                        [s.id, s.followerId, s.followingId, s.createdAt]
                    );
                }
            } else if (file === 'certificates') {
                for (const c of data) {
                    await pool.query(
                        `INSERT INTO certificates (id, user_id, title, image, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
                        [c.id, c.userId, c.title, c.image, c.createdAt]
                    );
                }
            }
            console.log(`✅ Миграция ${file} завершена (${data.length} записей)`);
        } catch (err) {
            console.error(`❌ Ошибка миграции ${file}:`, err);
        }
    }
    console.log('🚀 Миграция завершена!');
    process.exit(0);
}

migrate();