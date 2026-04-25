const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

// Создание папок для загрузок
const uploadDirs = ['public/uploads', 'public/uploads/images', 'public/uploads/audio', 'public/uploads/recordings', 'public/uploads/files', 'public/uploads/certificates', 'public/uploads/videos'];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'avatar') cb(null, 'public/uploads/images/');
        else if (file.fieldname === 'image') cb(null, 'public/uploads/images/');
        else if (file.fieldname === 'video') cb(null, 'public/uploads/videos/');
        else if (file.fieldname === 'voice') cb(null, 'public/uploads/audio/');
        else if (file.fieldname === 'recording') cb(null, 'public/uploads/recordings/');
        else if (file.fieldname === 'certificate') cb(null, 'public/uploads/certificates/');
        else if (file.fieldname === 'file') cb(null, 'public/uploads/files/');
        else cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ----------------------------------------------------------------------
// Функция безопасного парсинга JSON
// ----------------------------------------------------------------------
function safeJSONParse(str, defaultValue = null) {
    if (!str || typeof str !== 'string') return defaultValue;
    try {
        return JSON.parse(str);
    } catch (e) {
        console.warn(`⚠️ Ошибка парсинга JSON: ${e.message}, значение: ${str?.substring(0, 100)}`);
        return defaultValue;
    }
}

// ----------------------------------------------------------------------
// Получение пользователя из БД
// ----------------------------------------------------------------------
async function getUser(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    
    // Преобразуем snake_case в camelCase
    const user = {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        password: row.password,
        role: row.role,
        specialization: row.specialization,
        experience: row.experience,
        about: row.about,
        price: row.price,
        rating: row.rating,
        avatar: row.avatar,
        createdAt: row.created_at,
        // Парсим JSON поля с защитой
        topics: safeJSONParse(row.topics, []),
        schedule: safeJSONParse(row.schedule, {}),
        certificates: safeJSONParse(row.certificates, []),
        appointments: safeJSONParse(row.appointments, []),
        clients: safeJSONParse(row.clients, []),
        notifications: safeJSONParse(row.notifications, []),
        unreadCounts: safeJSONParse(row.unread_counts, {})
    };
    return user;
}

// ----------------------------------------------------------------------
// Сохранение пользователя (обновление)
// ----------------------------------------------------------------------
async function updateUser(user) {
    // Сериализуем JSON поля, гарантируя валидность
    const topics = JSON.stringify(Array.isArray(user.topics) ? user.topics : []);
    const schedule = JSON.stringify(user.schedule && typeof user.schedule === 'object' ? user.schedule : {});
    const certificates = JSON.stringify(Array.isArray(user.certificates) ? user.certificates : []);
    const appointments = JSON.stringify(Array.isArray(user.appointments) ? user.appointments : []);
    const clients = JSON.stringify(Array.isArray(user.clients) ? user.clients : []);
    const notifications = JSON.stringify(Array.isArray(user.notifications) ? user.notifications : []);
    const unreadCounts = JSON.stringify(user.unreadCounts && typeof user.unreadCounts === 'object' ? user.unreadCounts : {});
    
    await pool.query(
        `UPDATE users SET 
            full_name = $2, email = $3, phone = $4, password = $5, role = $6,
            specialization = $7, experience = $8, about = $9, price = $10,
            topics = $11, schedule = $12, certificates = $13, rating = $14,
            avatar = $15, appointments = $16, clients = $17, notifications = $18, unread_counts = $19,
            created_at = $20
         WHERE id = $1`,
        [
            user.id, user.fullName, user.email, user.phone, user.password,
            user.role, user.specialization, user.experience, user.about, user.price,
            topics, schedule, certificates, user.rating,
            user.avatar, appointments, clients, notifications, unreadCounts,
            user.createdAt || new Date().toISOString()
        ]
    );
}

// ----------------------------------------------------------------------
// Инициализация базы: принудительная очистка JSON полей (выполняется один раз)
// ----------------------------------------------------------------------
async function initDatabase() {
    // Убедимся, что все JSON поля содержат валидные значения
    await pool.query(`
        UPDATE users SET 
            topics = '[]'::jsonb WHERE topics IS NULL OR topics::text NOT LIKE '[%' AND topics::text NOT LIKE '{%';
        UPDATE users SET 
            schedule = '{}'::jsonb WHERE schedule IS NULL OR schedule::text NOT LIKE '{%' AND schedule::text NOT LIKE '[%';
        UPDATE users SET 
            certificates = '[]'::jsonb WHERE certificates IS NULL OR certificates::text NOT LIKE '[%';
        UPDATE users SET 
            appointments = '[]'::jsonb WHERE appointments IS NULL OR appointments::text NOT LIKE '[%';
        UPDATE users SET 
            clients = '[]'::jsonb WHERE clients IS NULL OR clients::text NOT LIKE '[%';
        UPDATE users SET 
            notifications = '[]'::jsonb WHERE notifications IS NULL OR notifications::text NOT LIKE '[%';
        UPDATE users SET 
            unread_counts = '{}'::jsonb WHERE unread_counts IS NULL OR unread_counts::text NOT LIKE '{%';
    `);
    console.log('✅ База данных инициализирована (JSON поля приведены к норме)');
}

// ----------------------------------------------------------------------
// РЕГИСТРАЦИЯ И АВТОРИЗАЦИЯ
// ----------------------------------------------------------------------
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, phone, password, role, specialization, experience, about } = req.body;
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) return res.json({ success: false, error: 'Email уже используется' });
        if (role === 'psychologist' && (!specialization || !experience)) {
            return res.json({ success: false, error: 'Заполните специализацию и опыт' });
        }
        const id = Date.now().toString();
        const createdAt = new Date().toISOString();
        const newUser = {
            id, fullName, email, phone: phone || '', password, role,
            specialization: specialization || '', experience: experience || '', about: about || '',
            price: 0, rating: 0,
            avatar: `https://ui-avatars.com/api/?background=8bca8b&color=fff&name=${encodeURIComponent(fullName)}&size=128`,
            createdAt,
            topics: [], schedule: {}, certificates: [], appointments: [], clients: [], notifications: [], unreadCounts: {}
        };
        
        await pool.query(
            `INSERT INTO users (id, full_name, email, phone, password, role, specialization, experience, about, price, topics, schedule, certificates, rating, avatar, appointments, clients, notifications, unread_counts, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
            [
                newUser.id, newUser.fullName, newUser.email, newUser.phone, newUser.password,
                newUser.role, newUser.specialization, newUser.experience, newUser.about, newUser.price,
                JSON.stringify(newUser.topics), JSON.stringify(newUser.schedule), JSON.stringify(newUser.certificates),
                newUser.rating, newUser.avatar,
                JSON.stringify(newUser.appointments), JSON.stringify(newUser.clients),
                JSON.stringify(newUser.notifications), JSON.stringify(newUser.unreadCounts), newUser.createdAt
            ]
        );
        res.json({ success: true, userId: id, role });
    } catch (err) {
        console.error('Register error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT id, role, full_name FROM users WHERE email = $1 AND password = $2', [email, password]);
        if (result.rows.length > 0) {
            res.json({ success: true, userId: result.rows[0].id, role: result.rows[0].role, fullName: result.rows[0].full_name });
        } else {
            res.json({ success: false, error: 'Неверный email или пароль' });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/user/:id', async (req, res) => {
    try {
        const user = await getUser(req.params.id);
        if (!user) return res.json({ success: false, error: 'Пользователь не найден' });
        const { password, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (err) {
        console.error('Get user error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.put('/api/user/profile', upload.single('avatar'), async (req, res) => {
    try {
        const { userId, fullName, phone, about, specialization, experience, price, topics, avatar } = req.body;
        const user = await getUser(userId);
        if (!user) return res.json({ success: false, error: 'Пользователь не найден' });
        
        if (fullName) user.fullName = fullName;
        if (phone) user.phone = phone;
        if (about) user.about = about;
        if (specialization) user.specialization = specialization;
        if (experience) user.experience = experience;
        if (price) user.price = parseInt(price);
        if (topics) user.topics = typeof topics === 'string' ? JSON.parse(topics) : topics;
        if (req.file) user.avatar = `/uploads/images/${req.file.filename}`;
        else if (avatar) user.avatar = avatar;
        
        await updateUser(user);
        const { password, ...safeUser } = user;
        res.json({ success: true, user: safeUser });
    } catch (err) {
        console.error('Profile update error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.put('/api/schedule', async (req, res) => {
    try {
        const { userId, schedule } = req.body;
        const user = await getUser(userId);
        if (!user || user.role !== 'psychologist') return res.json({ success: false });
        user.schedule = schedule;
        await updateUser(user);
        res.json({ success: true });
    } catch (err) {
        console.error('Schedule error:', err);
        res.json({ success: false });
    }
});

// ----------------------------------------------------------------------
// ЗАГРУЗКА ФАЙЛОВ
// ----------------------------------------------------------------------
app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    res.json({ success: true, avatarUrl: `/uploads/images/${req.file.filename}` });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    res.json({ success: true, fileUrl: `/uploads/files/${req.file.filename}` });
});

app.post('/api/upload-chat-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    res.json({ success: true, imageUrl: `/uploads/images/${req.file.filename}` });
});

app.post('/api/upload-voice', upload.single('voice'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    res.json({ success: true, voiceUrl: `/uploads/audio/${req.file.filename}` });
});

app.post('/api/upload-recording', upload.single('recording'), async (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    const recording = {
        id: Date.now().toString(),
        url: `/uploads/recordings/${req.file.filename}`,
        from_user: req.body.from,
        to_user: req.body.to,
        room_id: req.body.roomId,
        created_at: new Date().toISOString()
    };
    await pool.query(
        `INSERT INTO recordings (id, url, from_user, to_user, room_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [recording.id, recording.url, recording.from_user, recording.to_user, recording.room_id, recording.created_at]
    );
    res.json({ success: true, recordingUrl: recording.url });
});

// ----------------------------------------------------------------------
// СЕРТИФИКАТЫ
// ----------------------------------------------------------------------
app.post('/api/certificates', upload.single('certificate'), async (req, res) => {
    try {
        const { userId, title } = req.body;
        const user = await getUser(userId);
        if (!user || user.role !== 'psychologist') return res.json({ success: false, error: 'Нет прав' });
        if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
        const newCert = {
            id: Date.now().toString(),
            user_id: userId,
            title: title || 'Сертификат',
            image: `/uploads/certificates/${req.file.filename}`,
            created_at: new Date().toISOString()
        };
        await pool.query(`INSERT INTO certificates (id, user_id, title, image, created_at) VALUES ($1, $2, $3, $4, $5)`,
            [newCert.id, newCert.user_id, newCert.title, newCert.image, newCert.created_at]);
        if (!user.certificates) user.certificates = [];
        user.certificates.push({ id: newCert.id, title: newCert.title, image: newCert.image });
        await updateUser(user);
        const { password, ...safeUser } = user;
        res.json({ success: true, certificate: newCert, user: safeUser });
    } catch (err) {
        console.error('Add certificate error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.delete('/api/certificates/:userId/:certId', async (req, res) => {
    try {
        const user = await getUser(req.params.userId);
        if (!user) return res.json({ success: false });
        await pool.query('DELETE FROM certificates WHERE id = $1', [req.params.certId]);
        if (user.certificates) {
            user.certificates = user.certificates.filter(c => c.id !== req.params.certId);
            await updateUser(user);
        }
        const { password, ...safeUser } = user;
        res.json({ success: true, user: safeUser });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------------------------
// ПОСТЫ
// ----------------------------------------------------------------------
app.post('/api/posts', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
    try {
        const { authorId, text } = req.body;
        const author = await getUser(authorId);
        if (!author || author.role !== 'psychologist') return res.json({ success: false, error: 'Только психологи могут создавать посты' });
        const imageFile = req.files?.image?.[0];
        const videoFile = req.files?.video?.[0];
        const newPost = {
            id: Date.now().toString(),
            author_id: authorId,
            text,
            image: imageFile ? `/uploads/images/${imageFile.filename}` : null,
            video: videoFile ? `/uploads/videos/${videoFile.filename}` : null,
            created_at: new Date().toISOString()
        };
        await pool.query(`INSERT INTO posts (id, author_id, text, image, video, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [newPost.id, newPost.author_id, newPost.text, newPost.image, newPost.video, newPost.created_at]);
        io.emit('post_created', newPost);
        res.json({ success: true, post: newPost });
    } catch (err) {
        console.error('Create post error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.get('/api/posts', async (req, res) => {
    try {
        const postsRes = await pool.query('SELECT * FROM posts ORDER BY created_at DESC');
        const posts = postsRes.rows;
        const enriched = [];
        for (const post of posts) {
            const author = await getUser(post.author_id);
            const likesCountRes = await pool.query('SELECT COUNT(*) FROM likes WHERE post_id = $1', [post.id]);
            const likesCount = parseInt(likesCountRes.rows[0].count);
            const commentsRes = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at ASC', [post.id]);
            const comments = [];
            for (const c of commentsRes.rows) {
                const commentAuthor = await getUser(c.author_id);
                comments.push({
                    ...c,
                    author: { id: commentAuthor.id, fullName: commentAuthor.fullName, avatar: commentAuthor.avatar }
                });
            }
            let userLiked = false;
            if (req.query.userId) {
                const likedRes = await pool.query('SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2', [post.id, req.query.userId]);
                userLiked = likedRes.rows.length > 0;
            }
            enriched.push({
                id: post.id,
                text: post.text,
                image: post.image,
                video: post.video,
                createdAt: post.created_at,
                author: { id: author.id, fullName: author.fullName, avatar: author.avatar, rating: author.rating || 0 },
                likesCount,
                commentsCount: comments.length,
                comments,
                userLiked
            });
        }
        res.json({ success: true, posts: enriched });
    } catch (err) {
        console.error('Get posts error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.put('/api/posts/:id', upload.single('image'), async (req, res) => {
    try {
        const postId = req.params.id;
        const { authorId, text } = req.body;
        const postRes = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
        if (postRes.rows.length === 0) return res.json({ success: false, error: 'Пост не найден' });
        const post = postRes.rows[0];
        if (post.author_id !== authorId) return res.json({ success: false, error: 'Нет прав' });
        let newImage = post.image;
        if (req.file) newImage = `/uploads/images/${req.file.filename}`;
        await pool.query('UPDATE posts SET text = $1, image = $2 WHERE id = $3', [text, newImage, postId]);
        io.emit('post_updated', { id: postId, text, image: newImage });
        res.json({ success: true });
    } catch (err) {
        console.error('Update post error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const postId = req.params.id;
        const { authorId } = req.body;
        const postRes = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
        if (postRes.rows.length === 0) return res.json({ success: false, error: 'Пост не найден' });
        const post = postRes.rows[0];
        if (post.author_id !== authorId) return res.json({ success: false, error: 'Нет прав' });
        await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
        await pool.query('DELETE FROM likes WHERE post_id = $1', [postId]);
        await pool.query('DELETE FROM comments WHERE post_id = $1', [postId]);
        io.emit('post_deleted', postId);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete post error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ----------------------------------------------------------------------
// КОММЕНТАРИИ (сокращённо, но полностью)
// ----------------------------------------------------------------------
app.post('/api/posts/:id/comment', async (req, res) => {
    try {
        const { userId, text } = req.body;
        const postId = req.params.id;
        const newComment = {
            id: Date.now().toString(),
            post_id: postId,
            author_id: userId,
            text,
            created_at: new Date().toISOString()
        };
        await pool.query(`INSERT INTO comments (id, post_id, author_id, text, created_at) VALUES ($1, $2, $3, $4, $5)`,
            [newComment.id, newComment.post_id, newComment.author_id, newComment.text, newComment.created_at]);
        const author = await getUser(userId);
        const commentWithAuthor = { ...newComment, author: { id: author.id, fullName: author.fullName, avatar: author.avatar } };
        io.emit('comment_created', { postId, comment: commentWithAuthor });
        res.json({ success: true });
    } catch (err) {
        console.error('Add comment error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.put('/api/comments/:id', async (req, res) => {
    try {
        const commentId = req.params.id;
        const { userId, text } = req.body;
        const commentRes = await pool.query('SELECT * FROM comments WHERE id = $1', [commentId]);
        if (commentRes.rows.length === 0) return res.json({ success: false, error: 'Комментарий не найден' });
        if (commentRes.rows[0].author_id !== userId) return res.json({ success: false, error: 'Нет прав' });
        await pool.query('UPDATE comments SET text = $1 WHERE id = $2', [text, commentId]);
        io.emit('comment_updated', { commentId, text, postId: commentRes.rows[0].post_id });
        res.json({ success: true });
    } catch (err) {
        console.error('Update comment error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.delete('/api/comments/:id', async (req, res) => {
    try {
        const commentId = req.params.id;
        const { userId } = req.body;
        const commentRes = await pool.query('SELECT * FROM comments WHERE id = $1', [commentId]);
        if (commentRes.rows.length === 0) return res.json({ success: false, error: 'Комментарий не найден' });
        if (commentRes.rows[0].author_id !== userId) return res.json({ success: false, error: 'Нет прав' });
        await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
        io.emit('comment_deleted', { commentId, postId: commentRes.rows[0].post_id });
        res.json({ success: true });
    } catch (err) {
        console.error('Delete comment error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ----------------------------------------------------------------------
// ЛАЙКИ
// ----------------------------------------------------------------------
app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const { userId } = req.body;
        const postId = req.params.id;
        const existing = await pool.query('SELECT 1 FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
            const countRes = await pool.query('SELECT COUNT(*) FROM likes WHERE post_id = $1', [postId]);
            const likesCount = parseInt(countRes.rows[0].count);
            io.emit('post_liked', { postId, likesCount, userId, liked: false });
            res.json({ success: true, liked: false, likesCount });
        } else {
            await pool.query(`INSERT INTO likes (id, post_id, user_id, created_at) VALUES ($1, $2, $3, $4)`,
                [Date.now().toString(), postId, userId, new Date().toISOString()]);
            const countRes = await pool.query('SELECT COUNT(*) FROM likes WHERE post_id = $1', [postId]);
            const likesCount = parseInt(countRes.rows[0].count);
            io.emit('post_liked', { postId, likesCount, userId, liked: true });
            res.json({ success: true, liked: true, likesCount });
        }
    } catch (err) {
        console.error('Like error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ----------------------------------------------------------------------
// ЗАПИСИ НА ПРИЁМ (сокращённо, рабочий блок)
// ----------------------------------------------------------------------
app.post('/api/appointment', async (req, res) => {
    try {
        const { clientId, psychologistId, date, time } = req.body;
        const client = await getUser(clientId);
        const psychologist = await getUser(psychologistId);
        if (!client || !psychologist) return res.json({ success: false, error: 'Пользователь не найден' });
        const daySchedule = psychologist.schedule?.[date];
        if (!daySchedule || !daySchedule.includes(time)) return res.json({ success: false, error: 'Это время уже занято' });
        psychologist.schedule[date] = daySchedule.filter(t => t !== time);
        if (psychologist.schedule[date].length === 0) delete psychologist.schedule[date];
        await updateUser(psychologist);
        const roomId = Math.random().toString(36).substring(2, 10).toUpperCase();
        const appointment = {
            id: Date.now().toString(),
            psychologist_id: psychologistId,
            client_id: clientId,
            psychologist_name: psychologist.fullName,
            client_name: client.fullName,
            date, time, room_id: roomId, status: 'pending', created_at: new Date().toISOString()
        };
        await pool.query(
            `INSERT INTO appointments (id, psychologist_id, client_id, psychologist_name, client_name, date, time, room_id, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [appointment.id, appointment.psychologist_id, appointment.client_id, appointment.psychologist_name,
             appointment.client_name, appointment.date, appointment.time, appointment.room_id, appointment.status, appointment.created_at]
        );
        if (!client.appointments) client.appointments = [];
        client.appointments.push(appointment);
        if (!psychologist.clients) psychologist.clients = [];
        psychologist.clients.push({ clientId, clientName: client.fullName, appointmentId: appointment.id, date, time, status: 'pending', roomId });
        await updateUser(client);
        await updateUser(psychologist);
        const notification = {
            id: Date.now().toString(),
            type: 'new_appointment',
            title: 'Новая заявка',
            message: `${client.fullName} хочет записаться на ${date} в ${time}`,
            appointmentId: appointment.id, roomId,
            read: false, createdAt: new Date().toISOString()
        };
        if (!psychologist.notifications) psychologist.notifications = [];
        psychologist.notifications.unshift(notification);
        await updateUser(psychologist);
        io.to(psychologistId).emit('notification', notification);
        io.to(psychologistId).emit('appointment_created', appointment);
        res.json({ success: true });
    } catch (err) {
        console.error('Appointment error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/appointment/confirm', async (req, res) => {
    try {
        const { appointmentId, psychologistId, clientId } = req.body;
        await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', ['confirmed', appointmentId]);
        const psychologist = await getUser(psychologistId);
        const client = await getUser(clientId);
        if (psychologist && psychologist.clients) {
            const c = psychologist.clients.find(c => c.appointmentId === appointmentId);
            if (c) c.status = 'confirmed';
            await updateUser(psychologist);
        }
        if (client && client.appointments) {
            const a = client.appointments.find(a => a.id === appointmentId);
            if (a) a.status = 'confirmed';
            await updateUser(client);
        }
        if (psychologist && psychologist.notifications) {
            psychologist.notifications = psychologist.notifications.filter(n => n.appointmentId !== appointmentId);
            await updateUser(psychologist);
        }
        const appointmentRes = await pool.query('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
        const appointment = appointmentRes.rows[0];
        const clientNotif = {
            id: Date.now().toString(), type: 'appointment_confirmed',
            title: 'Запись подтверждена!',
            message: `${psychologist.fullName} подтвердил запись на ${appointment.date} в ${appointment.time}`,
            appointmentId, roomId: appointment.room_id, read: false, createdAt: new Date().toISOString()
        };
        if (!client.notifications) client.notifications = [];
        client.notifications.unshift(clientNotif);
        await updateUser(client);
        io.to(clientId).emit('notification', clientNotif);
        io.to(clientId).emit('appointment_updated', appointment);
        io.to(psychologistId).emit('appointment_updated', appointment);
        res.json({ success: true });
    } catch (err) {
        console.error('Confirm appointment error:', err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/appointment/complete', async (req, res) => {
    try {
        const { appointmentId } = req.body;
        await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', ['completed', appointmentId]);
        const appointmentRes = await pool.query('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
        const appointment = appointmentRes.rows[0];
        if (!appointment) return res.json({ success: false });
        const psychologist = await getUser(appointment.psychologist_id);
        const client = await getUser(appointment.client_id);
        if (psychologist && psychologist.clients) {
            const c = psychologist.clients.find(c => c.appointmentId === appointmentId);
            if (c) c.status = 'completed';
            await updateUser(psychologist);
        }
        if (client && client.appointments) {
            const a = client.appointments.find(a => a.id === appointmentId);
            if (a) a.status = 'completed';
            await updateUser(client);
        }
        io.to(appointment.psychologist_id).emit('appointment_completed', appointmentId);
        io.to(appointment.client_id).emit('appointment_completed', appointmentId);
        res.json({ success: true });
    } catch (err) {
        console.error('Complete appointment error:', err);
        res.json({ success: false });
    }
});

// ----------------------------------------------------------------------
// ЗАДАЧИ, ЗАМЕТКИ, ОТЗЫВЫ, ПОИСК, ПОДПИСКИ (шаблонно, но рабочие)
// ----------------------------------------------------------------------
app.get('/api/tasks/:psychologistId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tasks WHERE psychologist_id = $1 ORDER BY created_at DESC', [req.params.psychologistId]);
        res.json({ success: true, tasks: result.rows });
    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});
app.post('/api/tasks', async (req, res) => {
    try {
        const { psychologistId, text, dueDate } = req.body;
        const newTask = { id: Date.now().toString(), psychologist_id: psychologistId, text, due_date: dueDate || null, completed: false, created_at: new Date().toISOString() };
        await pool.query(`INSERT INTO tasks (id, psychologist_id, text, due_date, completed, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [newTask.id, newTask.psychologist_id, newTask.text, newTask.due_date, newTask.completed, newTask.created_at]);
        res.json({ success: true, task: newTask });
    } catch (err) { res.json({ success: false }); }
});
app.put('/api/tasks/:taskId', async (req, res) => {
    try { const { completed, text, dueDate } = req.body; await pool.query('UPDATE tasks SET completed = $1, text=$2, due_date=$3 WHERE id=$4', [completed, text, dueDate, req.params.taskId]); res.json({ success: true }); } catch(e) { res.json({ success: false }); }
});
app.delete('/api/tasks/:taskId', async (req, res) => {
    try { await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.taskId]); res.json({ success: true }); } catch(e) { res.json({ success: false }); }
});

app.get('/api/notes/:psychologistId', async (req, res) => {
    try { const result = await pool.query('SELECT * FROM notes WHERE psychologist_id = $1 ORDER BY created_at DESC', [req.params.psychologistId]); res.json({ success: true, notes: result.rows }); } catch(e) { res.json({ success: false }); }
});
app.post('/api/notes', async (req, res) => {
    try { const { psychologistId, title, content, attachment, attachmentType } = req.body; const newNote = { id: Date.now().toString(), psychologist_id: psychologistId, title, content, attachment: attachment || null, attachment_type: attachmentType || null, created_at: new Date().toISOString() }; await pool.query(`INSERT INTO notes (id, psychologist_id, title, content, attachment, attachment_type, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [newNote.id, newNote.psychologist_id, newNote.title, newNote.content, newNote.attachment, newNote.attachment_type, newNote.created_at]); res.json({ success: true, note: newNote }); } catch(e) { res.json({ success: false }); }
});
app.delete('/api/notes/:noteId', async (req, res) => { try { await pool.query('DELETE FROM notes WHERE id=$1', [req.params.noteId]); res.json({ success: true }); } catch(e) { res.json({ success: false }); } });

app.post('/api/reviews', async (req, res) => {
    try {
        const { psychologistId, clientId, rating, text } = req.body;
        const client = await getUser(clientId);
        const psychologist = await getUser(psychologistId);
        if (!client || !psychologist) return res.json({ success: false, error: 'Пользователь не найден' });
        const hasAppointment = client.appointments?.some(a => a.psychologist_id === psychologistId && a.status === 'confirmed');
        if (!hasAppointment) return res.json({ success: false, error: 'Только после подтверждённого звонка' });
        const existing = await pool.query('SELECT 1 FROM reviews WHERE psychologist_id=$1 AND client_id=$2', [psychologistId, clientId]);
        if (existing.rows.length) return res.json({ success: false, error: 'Вы уже оставляли отзыв' });
        const newReview = { id: Date.now().toString(), psychologist_id: psychologistId, client_id: clientId, client_name: client.fullName, rating: Math.min(5, Math.max(1, rating)), text, created_at: new Date().toISOString() };
        await pool.query(`INSERT INTO reviews (id, psychologist_id, client_id, client_name, rating, text, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [newReview.id, newReview.psychologist_id, newReview.client_id, newReview.client_name, newReview.rating, newReview.text, newReview.created_at]);
        const reviewsRes = await pool.query('SELECT rating FROM reviews WHERE psychologist_id=$1', [psychologistId]);
        let avgRating = 0;
        if (reviewsRes.rows.length) avgRating = reviewsRes.rows.reduce((s,r)=>s+r.rating,0)/reviewsRes.rows.length;
        const postsRes = await pool.query('SELECT id FROM posts WHERE author_id=$1', [psychologist.id]);
        let totalLikes = 0;
        for (const p of postsRes.rows) { const likesRes = await pool.query('SELECT COUNT(*) FROM likes WHERE post_id=$1', [p.id]); totalLikes += parseInt(likesRes.rows[0].count); }
        const bonus = Math.min(1, totalLikes * 0.01);
        psychologist.rating = Math.min(5, avgRating + bonus);
        await updateUser(psychologist);
        res.json({ success: true, review: newReview, newRating: psychologist.rating });
    } catch(err) { console.error(err); res.json({ success: false }); }
});
app.get('/api/reviews/:psychologistId', async (req, res) => {
    try { const result = await pool.query('SELECT * FROM reviews WHERE psychologist_id=$1 ORDER BY created_at DESC', [req.params.psychologistId]); res.json({ success: true, reviews: result.rows }); } catch(e) { res.json({ success: false }); }
});

app.get('/api/search/psychologists', async (req, res) => {
    try { const query = req.query.q?.toLowerCase() || ''; const result = await pool.query(`SELECT id, full_name, avatar, specialization, rating FROM users WHERE role='psychologist' AND LOWER(full_name) LIKE $1`, [`%${query}%`]); res.json({ success: true, psychologists: result.rows }); } catch(e) { res.json({ success: false }); }
});

app.get('/api/subscriptions/:userId', async (req, res) => {
    try { const followingRes = await pool.query('SELECT following_id FROM subscriptions WHERE follower_id=$1', [req.params.userId]); const followersRes = await pool.query('SELECT follower_id FROM subscriptions WHERE following_id=$1', [req.params.userId]); res.json({ success: true, following: followingRes.rows.map(r=>r.following_id), followers: followersRes.rows.map(r=>r.follower_id) }); } catch(e) { res.json({ success: false }); }
});
app.post('/api/subscriptions', async (req, res) => {
    try { const { followerId, followingId } = req.body; const existing = await pool.query('SELECT 1 FROM subscriptions WHERE follower_id=$1 AND following_id=$2', [followerId, followingId]); if (existing.rows.length) { await pool.query('DELETE FROM subscriptions WHERE follower_id=$1 AND following_id=$2', [followerId, followingId]); res.json({ success: true, subscribed: false }); } else { await pool.query(`INSERT INTO subscriptions (id, follower_id, following_id, created_at) VALUES ($1,$2,$3,$4)`, [Date.now().toString(), followerId, followingId, new Date().toISOString()]); res.json({ success: true, subscribed: true }); } } catch(e) { res.json({ success: false }); }
});

// ----------------------------------------------------------------------
// ЧАТ
// ----------------------------------------------------------------------
app.get('/api/messages/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const user = await getUser(userId);
        if (!user) return res.json({ success: false });
        const contactIds = user.role === 'client'
            ? (await pool.query('SELECT id FROM users WHERE role=$1', ['psychologist'])).rows.map(r=>r.id)
            : [...new Set([...(await pool.query('SELECT id FROM users WHERE role=$1 AND id!=$2', ['psychologist', userId])).rows.map(r=>r.id), ...(user.clients?.map(c=>c.clientId)||[])])];
        const messagesRes = await pool.query('SELECT * FROM messages WHERE from_user=$1 OR to_user=$1 ORDER BY created_at ASC', [userId]);
        const messages = messagesRes.rows;
        const contacts = [];
        for (const id of contactIds) { const u = await getUser(id); if (u) contacts.push({ id: u.id, fullName: u.fullName, avatar: u.avatar, role: u.role }); }
        res.json({ success: true, messages, users: contacts });
    } catch(err) { console.error(err); res.json({ success: false }); }
});

app.post('/api/messages', async (req, res) => {
    try {
        const { from, to, text, image, voice } = req.body;
        const newMsg = { id: Date.now().toString(), from_user: from, to_user: to, text: text || '', image: image || null, voice: voice || null, is_read: false, created_at: new Date().toISOString() };
        await pool.query(`INSERT INTO messages (id, from_user, to_user, text, image, voice, is_read, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [newMsg.id, newMsg.from_user, newMsg.to_user, newMsg.text, newMsg.image, newMsg.voice, newMsg.is_read, newMsg.created_at]);
        const recipient = await getUser(to);
        if (recipient) {
            if (!recipient.unreadCounts) recipient.unreadCounts = {};
            recipient.unreadCounts[from] = (recipient.unreadCounts[from] || 0) + 1;
            await updateUser(recipient);
            io.to(to).emit('unread_update', { from, count: recipient.unreadCounts[from] });
        }
        io.to(to).emit('new_message', newMsg);
        res.json({ success: true });
    } catch(err) { console.error(err); res.json({ success: false, error: 'Ошибка сервера' }); }
});

app.post('/api/messages/read', async (req, res) => {
    try {
        const { userId, fromUserId } = req.body;
        const user = await getUser(userId);
        if (user && user.unreadCounts && user.unreadCounts[fromUserId]) {
            delete user.unreadCounts[fromUserId];
            await updateUser(user);
        }
        await pool.query('UPDATE messages SET is_read = true WHERE to_user = $1 AND from_user = $2', [userId, fromUserId]);
        res.json({ success: true });
    } catch(err) { console.error(err); res.json({ success: false }); }
});

app.get('/api/psychologists', async (req, res) => {
    try { const result = await pool.query('SELECT id, full_name, avatar, specialization, rating, price FROM users WHERE role=$1', ['psychologist']); res.json({ success: true, psychologists: result.rows }); } catch(e) { res.json({ success: false }); }
});

// ----------------------------------------------------------------------
// WEBRTC
// ----------------------------------------------------------------------
const activeRooms = new Map();
io.on('connection', (socket) => {
    console.log('🔌 WebSocket connected');
    socket.on('register_user', (userId) => { socket.userId = userId; if (userId) socket.join(userId); });
    socket.on('join-call-room', (roomId, userId, userType) => {
        try {
            if (!activeRooms.has(roomId)) activeRooms.set(roomId, { psychologist: null, client: null, users: new Map() });
            const room = activeRooms.get(roomId);
            if (userType === 'psychologist' && room.psychologist && room.psychologist !== socket.id) {
                io.to(room.psychologist).emit('partner-disconnected');
                const oldSocket = io.sockets.sockets.get(room.psychologist);
                if (oldSocket) oldSocket.leave(roomId);
                room.psychologist = socket.id;
                room.users.delete(room.psychologist);
            } else if (userType === 'client' && room.client && room.client !== socket.id) {
                io.to(room.client).emit('partner-disconnected');
                const oldSocket = io.sockets.sockets.get(room.client);
                if (oldSocket) oldSocket.leave(roomId);
                room.client = socket.id;
                room.users.delete(room.client);
            }
            room.users.set(socket.id, { userId, userType });
            if (userType === 'psychologist') room.psychologist = socket.id;
            else room.client = socket.id;
            socket.join(roomId);
            socket.roomId = roomId;
            socket.userId = userId;
            socket.userType = userType;
            if (room.psychologist && room.client) {
                io.to(room.psychologist).emit('call-ready', { partnerId: room.client });
                io.to(room.client).emit('call-ready', { partnerId: room.psychologist });
            }
            socket.emit('room-joined');
        } catch (err) { console.error(err); }
    });
    socket.on('call-message', (msgData) => {
        const room = activeRooms.get(socket.roomId);
        if (room) {
            const targetId = socket.userType === 'psychologist' ? room.client : room.psychologist;
            if (targetId) io.to(targetId).emit('call-message', { from: socket.userId, text: msgData.text, time: new Date().toISOString() });
        }
    });
    socket.on('offer', (data) => socket.to(data.target).emit('offer', { sdp: data.sdp, from: socket.id }));
    socket.on('answer', (data) => socket.to(data.target).emit('answer', { sdp: data.sdp, from: socket.id }));
    socket.on('ice-candidate', (data) => socket.to(data.target).emit('ice-candidate', { candidate: data.candidate, from: socket.id }));
    socket.on('end-call', async () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('call-ended');
            const room = activeRooms.get(socket.roomId);
            if (room && room.users.size >= 2) {
                const result = await pool.query('SELECT * FROM appointments WHERE room_id = $1', [socket.roomId]);
                const appointment = result.rows[0];
                if (appointment && appointment.status === 'confirmed') {
                    await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', ['completed', appointment.id]);
                    const psychologist = await getUser(appointment.psychologist_id);
                    const client = await getUser(appointment.client_id);
                    if (psychologist && psychologist.clients) {
                        const c = psychologist.clients.find(c => c.appointmentId === appointment.id);
                        if (c) c.status = 'completed';
                        await updateUser(psychologist);
                    }
                    if (client && client.appointments) {
                        const a = client.appointments.find(a => a.id === appointment.id);
                        if (a) a.status = 'completed';
                        await updateUser(client);
                    }
                    io.to(appointment.psychologist_id).emit('appointment_completed', appointment.id);
                    io.to(appointment.client_id).emit('appointment_completed', appointment.id);
                }
            }
            setTimeout(() => {
                const room = activeRooms.get(socket.roomId);
                if (room && (!room.psychologist || !room.client)) activeRooms.delete(socket.roomId);
            }, 5000);
            socket.leave(socket.roomId);
            delete socket.roomId;
        }
    });
    socket.on('disconnect', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner-disconnected');
            const room = activeRooms.get(socket.roomId);
            if (room) {
                room.users.delete(socket.id);
                if (socket.userType === 'psychologist') room.psychologist = null;
                else room.client = null;
                if (room.users.size === 0) {
                    setTimeout(() => { if (activeRooms.get(socket.roomId)?.users.size === 0) activeRooms.delete(socket.roomId); }, 10000);
                }
            }
            socket.leave(socket.roomId);
        }
    });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

// Запуск сервера и инициализация БД
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    await initDatabase();
});