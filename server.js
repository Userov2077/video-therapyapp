const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Создание папок
const uploadDirs = ['public/uploads', 'public/uploads/images', 'public/uploads/audio', 'public/uploads/recordings'];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'avatar') cb(null, 'public/uploads/images/');
        else if (file.fieldname === 'image') cb(null, 'public/uploads/images/');
        else if (file.fieldname === 'voice') cb(null, 'public/uploads/audio/');
        else if (file.fieldname === 'recording') cb(null, 'public/uploads/recordings/');
        else if (file.fieldname === 'certificate') cb(null, 'public/uploads/images/');
        else if (file.fieldname === 'file') cb(null, 'public/uploads/images/');
        else cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// Загрузка данных
const dataPath = './data/';
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath);
const files = ['users', 'posts', 'likes', 'comments', 'messages', 'appointments', 'recordings'];
const globalData = {};
files.forEach(f => {
    try { globalData[f] = JSON.parse(fs.readFileSync(`${dataPath}${f}.json`, 'utf8')); }
    catch(e) { globalData[f] = []; }
});

function saveData() { files.forEach(f => fs.writeFileSync(`${dataPath}${f}.json`, JSON.stringify(globalData[f], null, 2))); }
const getUser = id => globalData.users.find(u => u.id === id);

// ---- Регистрация и авторизация (без изменений) ----
app.post('/api/register', (req, res) => {
    const { fullName, email, phone, password, role, specialization, experience, about } = req.body;
    if (globalData.users.find(u => u.email === email)) return res.json({ success: false, error: 'Email уже используется' });
    if (role === 'psychologist' && (!specialization || !experience)) return res.json({ success: false, error: 'Заполните специализацию и опыт' });
    
    const newUser = {
        id: Date.now().toString(),
        fullName,
        email,
        phone: phone || '',
        password,
        role,
        specialization: specialization || '',
        experience: experience || '',
        about: about || '',
        price: 0,
        topics: [],
        schedule: {},
        certificates: [],
        achievements: [],
        avatar: `https://ui-avatars.com/api/?background=8bca8b&color=fff&name=${encodeURIComponent(fullName)}&size=128`,
        createdAt: new Date().toISOString(),
        appointments: [],
        clients: [],
        notifications: []
    };
    globalData.users.push(newUser);
    saveData();
    res.json({ success: true, userId: newUser.id, role: newUser.role });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = globalData.users.find(u => u.email === email && u.password === password);
    if (user) res.json({ success: true, userId: user.id, role: user.role, fullName: user.fullName });
    else res.json({ success: false, error: 'Неверный email или пароль' });
});

app.get('/api/user/:id', (req, res) => {
    const user = getUser(req.params.id);
    if (user) { const { password, ...userData } = user; res.json({ success: true, user: userData }); }
    else res.json({ success: false, error: 'Пользователь не найден' });
});

app.put('/api/user/profile', upload.single('avatar'), (req, res) => {
    const { userId, fullName, phone, about, specialization, experience, price, topics, avatar } = req.body;
    const user = getUser(userId);
    if (!user) return res.json({ success: false, error: 'Пользователь не найден' });
    
    if (fullName) user.fullName = fullName;
    if (phone) user.phone = phone;
    if (about) user.about = about;
    if (specialization) user.specialization = specialization;
    if (experience) user.experience = experience;
    if (price) user.price = parseInt(price);
    if (topics) user.topics = typeof topics === 'string' ? JSON.parse(topics) : topics;
    
    if (req.file) {
        user.avatar = `/uploads/images/${req.file.filename}`;
    } else if (avatar) {
        user.avatar = avatar;
    }
    
    saveData();
    res.json({ success: true, user });
});

app.put('/api/schedule', (req, res) => {
    const { userId, schedule } = req.body;
    const user = getUser(userId);
    if (!user || user.role !== 'psychologist') return res.json({ success: false });
    user.schedule = schedule;
    saveData();
    res.json({ success: true });
});

// ---- Загрузка файлов ----
app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    res.json({ success: true, avatarUrl: `/uploads/images/${req.file.filename}` });
});

app.post('/api/upload-chat-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    res.json({ success: true, imageUrl: `/uploads/images/${req.file.filename}` });
});

app.post('/api/upload-voice', upload.single('voice'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    res.json({ success: true, voiceUrl: `/uploads/audio/${req.file.filename}` });
});

app.post('/api/upload-recording', upload.single('recording'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    const recording = {
        id: Date.now().toString(),
        url: `/uploads/recordings/${req.file.filename}`,
        from: req.body.from,
        to: req.body.to,
        roomId: req.body.roomId,
        createdAt: new Date().toISOString()
    };
    globalData.recordings.push(recording);
    saveData();
    res.json({ success: true, recordingUrl: recording.url });
});

// ---- Сертификаты и достижения ----
app.post('/api/certificate', upload.single('file'), (req, res) => {
    const { userId, title, description } = req.body;
    const user = getUser(userId);
    if (!user || user.role !== 'psychologist') return res.json({ success: false, error: 'Нет прав' });
    if (!req.file) return res.json({ success: false, error: 'Файл не загружен' });
    
    const cert = {
        id: Date.now().toString(),
        title: title || 'Сертификат',
        description: description || '',
        image: `/uploads/images/${req.file.filename}`,
        createdAt: new Date().toISOString()
    };
    user.certificates.push(cert);
    saveData();
    res.json({ success: true, certificate: cert });
});

app.delete('/api/certificate/:userId/:certId', (req, res) => {
    const user = getUser(req.params.userId);
    if (!user) return res.json({ success: false });
    user.certificates = user.certificates.filter(c => c.id !== req.params.certId);
    saveData();
    res.json({ success: true });
});

app.post('/api/achievement', (req, res) => {
    const { userId, text } = req.body;
    const user = getUser(userId);
    if (!user || user.role !== 'psychologist') return res.json({ success: false });
    user.achievements.push({ id: Date.now().toString(), text, createdAt: new Date().toISOString() });
    saveData();
    res.json({ success: true });
});

app.delete('/api/achievement/:userId/:achievementId', (req, res) => {
    const user = getUser(req.params.userId);
    if (!user) return res.json({ success: false });
    user.achievements = user.achievements.filter(a => a.id !== req.params.achievementId);
    saveData();
    res.json({ success: true });
});

// ---- Посты ----
app.get('/api/posts', (req, res) => {
    const posts = [...globalData.posts].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    const enriched = posts.map(post => {
        const author = getUser(post.authorId);
        const likesCount = globalData.likes.filter(l => l.postId === post.id).length;
        const comments = globalData.comments.filter(c => c.postId === post.id).map(c => ({ ...c, author: getUser(c.authorId) }));
        const userLiked = req.query.userId ? globalData.likes.some(l => l.postId === post.id && l.userId === req.query.userId) : false;
        return { 
            ...post, 
            author: { id: author.id, fullName: author.fullName, avatar: author.avatar },
            likesCount,
            commentsCount: comments.length,
            comments,
            userLiked
        };
    });
    res.json({ success: true, posts: enriched });
});

app.post('/api/posts', upload.single('image'), (req, res) => {
    const { authorId, text } = req.body;
    const author = getUser(authorId);
    if (!author || author.role !== 'psychologist') return res.json({ success: false, error: 'Только психологи могут создавать посты' });
    const newPost = { 
        id: Date.now().toString(), 
        authorId, 
        text, 
        image: req.file ? `/uploads/images/${req.file.filename}` : null, 
        createdAt: new Date().toISOString()
    };
    globalData.posts.push(newPost);
    saveData();
    io.emit('post_created', newPost);
    res.json({ success: true });
});

app.put('/api/posts/:id', upload.single('image'), (req, res) => {
    const postId = req.params.id;
    const { authorId, text } = req.body;
    const post = globalData.posts.find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Пост не найден' });
    if (post.authorId !== authorId) return res.json({ success: false, error: 'Нет прав' });
    post.text = text;
    if (req.file) post.image = `/uploads/images/${req.file.filename}`;
    saveData();
    io.emit('post_updated', { id: postId, text, image: post.image });
    res.json({ success: true });
});

app.delete('/api/posts/:id', (req, res) => {
    const postId = req.params.id;
    const { authorId } = req.body;
    const post = globalData.posts.find(p => p.id === postId);
    if (!post) return res.json({ success: false, error: 'Пост не найден' });
    if (post.authorId !== authorId) return res.json({ success: false, error: 'Нет прав' });
    globalData.posts = globalData.posts.filter(p => p.id !== postId);
    globalData.likes = globalData.likes.filter(l => l.postId !== postId);
    globalData.comments = globalData.comments.filter(c => c.postId !== postId);
    saveData();
    io.emit('post_deleted', postId);
    res.json({ success: true });
});

// ---- Комментарии ----
app.post('/api/posts/:id/comment', (req, res) => {
    const { userId, text } = req.body;
    const postId = req.params.id;
    const newComment = { 
        id: Date.now().toString(), 
        postId, 
        authorId: userId, 
        text, 
        createdAt: new Date().toISOString() 
    };
    globalData.comments.push(newComment);
    saveData();
    const author = getUser(userId);
    const commentWithAuthor = { ...newComment, author: { id: author.id, fullName: author.fullName, avatar: author.avatar } };
    io.emit('comment_created', { postId, comment: commentWithAuthor });
    res.json({ success: true });
});

app.put('/api/comments/:id', (req, res) => {
    const commentId = req.params.id;
    const { userId, text } = req.body;
    const comment = globalData.comments.find(c => c.id === commentId);
    if (!comment) return res.json({ success: false, error: 'Комментарий не найден' });
    if (comment.authorId !== userId) return res.json({ success: false, error: 'Нет прав' });
    comment.text = text;
    saveData();
    io.emit('comment_updated', { commentId, text, postId: comment.postId });
    res.json({ success: true });
});

app.delete('/api/comments/:id', (req, res) => {
    const commentId = req.params.id;
    const { userId } = req.body;
    const comment = globalData.comments.find(c => c.id === commentId);
    if (!comment) return res.json({ success: false, error: 'Комментарий не найден' });
    if (comment.authorId !== userId) return res.json({ success: false, error: 'Нет прав' });
    globalData.comments = globalData.comments.filter(c => c.id !== commentId);
    saveData();
    io.emit('comment_deleted', { commentId, postId: comment.postId });
    res.json({ success: true });
});

app.post('/api/posts/:id/like', (req, res) => {
    const { userId } = req.body;
    const postId = req.params.id;
    const existing = globalData.likes.find(l => l.postId === postId && l.userId === userId);
    if (existing) {
        globalData.likes = globalData.likes.filter(l => l !== existing);
        const likesCount = globalData.likes.filter(l => l.postId === postId).length;
        saveData();
        io.emit('post_liked', { postId, likesCount, userId, liked: false });
        res.json({ success: true, liked: false, likesCount });
    } else {
        globalData.likes.push({ id: Date.now().toString(), postId, userId, createdAt: new Date().toISOString() });
        const likesCount = globalData.likes.filter(l => l.postId === postId).length;
        saveData();
        io.emit('post_liked', { postId, likesCount, userId, liked: true });
        res.json({ success: true, liked: true, likesCount });
    }
});

// ---- Записи на приём ----
app.post('/api/appointment', (req, res) => {
    const { clientId, psychologistId, date, time } = req.body;
    const client = getUser(clientId);
    const psychologist = getUser(psychologistId);
    if (!client || !psychologist) return res.json({ success: false, error: 'Пользователь не найден' });
    
    const daySchedule = psychologist.schedule?.[date];
    if (!daySchedule || !daySchedule.includes(time)) return res.json({ success: false, error: 'Это время уже занято' });
    
    psychologist.schedule[date] = daySchedule.filter(t => t !== time);
    if (psychologist.schedule[date].length === 0) delete psychologist.schedule[date];
    
    const roomId = Math.random().toString(36).substring(2, 10).toUpperCase();
    const appointment = { id: Date.now().toString(), psychologistId, psychologistName: psychologist.fullName, clientId, clientName: client.fullName, date, time, roomId, status: 'pending', createdAt: new Date().toISOString() };
    globalData.appointments.push(appointment);
    client.appointments.push(appointment);
    psychologist.clients.push({ clientId, clientName: client.fullName, appointmentId: appointment.id, date, time, status: 'pending', roomId });
    const notification = { id: Date.now().toString(), type: 'new_appointment', title: 'Новая заявка', message: `${client.fullName} хочет записаться на ${date} в ${time}`, appointmentId: appointment.id, roomId, read: false, createdAt: new Date().toISOString() };
    psychologist.notifications.unshift(notification);
    saveData();
    io.to(psychologistId).emit('notification', notification);
    io.to(psychologistId).emit('appointment_created', appointment);
    res.json({ success: true });
});

app.post('/api/appointment/confirm', (req, res) => {
    const { appointmentId, psychologistId, clientId } = req.body;
    const appointment = globalData.appointments.find(a => a.id === appointmentId);
    if (!appointment) return res.json({ success: false });
    appointment.status = 'confirmed';
    const psychologist = getUser(psychologistId);
    const client = getUser(clientId);
    if (psychologist) { const c = psychologist.clients.find(c => c.appointmentId === appointmentId); if (c) c.status = 'confirmed'; }
    if (client) { const a = client.appointments.find(a => a.id === appointmentId); if (a) a.status = 'confirmed'; }
    const notification = { id: Date.now().toString(), type: 'appointment_confirmed', title: 'Запись подтверждена!', message: `${psychologist.fullName} подтвердил запись на ${appointment.date} в ${appointment.time}`, appointmentId, roomId: appointment.roomId, read: false, createdAt: new Date().toISOString() };
    client.notifications.unshift(notification);
    saveData();
    io.to(clientId).emit('notification', notification);
    io.to(clientId).emit('appointment_updated', appointment);
    io.to(psychologistId).emit('appointment_updated', appointment);
    res.json({ success: true });
});

// ---- Чат ----
app.get('/api/messages/:userId', (req, res) => {
    const userId = req.params.userId;
    const user = getUser(userId);
    if (!user) return res.json({ success: false });
    let contactIds = user.role === 'client' ? globalData.users.filter(u => u.role === 'psychologist').map(u => u.id) : [...new Set([...globalData.users.filter(u => u.role === 'psychologist' && u.id !== userId).map(u => u.id), ...(user.clients || []).map(c => c.clientId)])];
    const messages = globalData.messages.filter(m => m.from === userId || m.to === userId);
    const contacts = contactIds.map(id => getUser(id)).filter(u => u).map(u => ({ id: u.id, fullName: u.fullName, avatar: u.avatar, role: u.role }));
    res.json({ success: true, messages, users: contacts });
});

app.post('/api/messages', (req, res) => {
    const { from, to, text, image, voice } = req.body;
    const newMsg = { id: Date.now().toString(), from, to, text: text || '', image: image || null, voice: voice || null, createdAt: new Date().toISOString(), isRead: false };
    globalData.messages.push(newMsg);
    saveData();
    io.to(to).emit('new_message', newMsg);
    res.json({ success: true });
});

app.post('/api/messages/read', (req, res) => {
    const { userId, fromUserId } = req.body;
    globalData.messages.filter(m => m.to === userId && m.from === fromUserId && !m.isRead).forEach(m => m.isRead = true);
    saveData();
    res.json({ success: true });
});

app.get('/api/psychologists', (req, res) => {
    res.json({ success: true, psychologists: globalData.users.filter(u => u.role === 'psychologist').map(({ password, ...u }) => u) });
});

// ---- WebRTC комнаты с улучшенной очисткой и поддержкой переподключения ----
const activeRooms = new Map(); // roomId -> { psychologist: socketId, client: socketId, users: Map }

io.on('connection', (socket) => {
    console.log(`🔌 Новое подключение: ${socket.id}`);
    
    socket.on('register_user', (userId) => {
        socket.userId = userId;
        if (userId) {
            socket.join(userId);
            console.log(`👤 Пользователь ${userId} зарегистрирован, сокет ${socket.id}`);
        }
    });

    socket.on('join-call-room', (roomId, userId, userType) => {
        try {
            console.log(`📞 join-call-room: комната ${roomId}, пользователь ${userId} (${userType}), сокет ${socket.id}`);
            
            // Если комната уже существует, проверим, не заходит ли тот же пользователь повторно
            if (activeRooms.has(roomId)) {
                const room = activeRooms.get(roomId);
                // Если это психолог и в комнате уже есть психолог, удалим старого
                if (userType === 'psychologist' && room.psychologist && room.psychologist !== socket.id) {
                    const oldSocketId = room.psychologist;
                    console.log(`🔄 Замена психолога в комнате ${roomId}: ${oldSocketId} -> ${socket.id}`);
                    io.to(oldSocketId).emit('partner-disconnected');
                    // Удаляем старого из комнаты
                    const oldSocket = io.sockets.sockets.get(oldSocketId);
                    if (oldSocket) oldSocket.leave(roomId);
                    room.psychologist = socket.id;
                    room.users.delete(oldSocketId);
                } else if (userType === 'client' && room.client && room.client !== socket.id) {
                    const oldSocketId = room.client;
                    console.log(`🔄 Замена клиента в комнате ${roomId}: ${oldSocketId} -> ${socket.id}`);
                    io.to(oldSocketId).emit('partner-disconnected');
                    const oldSocket = io.sockets.sockets.get(oldSocketId);
                    if (oldSocket) oldSocket.leave(roomId);
                    room.client = socket.id;
                    room.users.delete(oldSocketId);
                }
                room.users.set(socket.id, { userId, userType });
                if (userType === 'psychologist') room.psychologist = socket.id;
                else room.client = socket.id;
            } else {
                // Новая комната
                activeRooms.set(roomId, { psychologist: null, client: null, users: new Map() });
                const room = activeRooms.get(roomId);
                room.users.set(socket.id, { userId, userType });
                if (userType === 'psychologist') room.psychologist = socket.id;
                else room.client = socket.id;
            }
            
            socket.join(roomId);
            socket.roomId = roomId;
            socket.userId = userId;
            socket.userType = userType;
            
            const room = activeRooms.get(roomId);
            console.log(`📊 Текущее состояние комнаты ${roomId}: психолог=${room.psychologist}, клиент=${room.client}, users=${room.users.size}`);
            
            // Если оба участника в комнате, уведомляем их
            if (room.psychologist && room.client) {
                console.log(`🎉 Оба участника в комнате ${roomId}, уведомляем о готовности`);
                io.to(room.psychologist).emit('call-ready', { partnerId: room.client });
                io.to(room.client).emit('call-ready', { partnerId: room.psychologist });
            }
            socket.emit('room-joined');
        } catch (err) {
            console.error('Ошибка в join-call-room:', err);
        }
    });
    
    socket.on('call-message', (msgData) => {
        try {
            const room = activeRooms.get(socket.roomId);
            if (room) {
                const targetId = socket.userType === 'psychologist' ? room.client : room.psychologist;
                if (targetId) {
                    io.to(targetId).emit('call-message', {
                        from: socket.userId,
                        text: msgData.text,
                        time: new Date().toISOString()
                    });
                }
                // Сохраняем сообщение в общий чат (опционально)
                const newMsg = { 
                    id: Date.now().toString(), 
                    from: socket.userId, 
                    to: socket.userType === 'psychologist' ? (room.client ? 'client' : 'unknown') : (room.psychologist ? 'psychologist' : 'unknown'),
                    text: msgData.text, 
                    createdAt: new Date().toISOString(), 
                    isRead: false 
                };
                globalData.messages.push(newMsg);
                saveData();
            }
        } catch (err) {
            console.error('Ошибка в call-message:', err);
        }
    });
    
    socket.on('offer', (data) => {
        console.log(`📤 Offer от ${socket.id} к ${data.target}`);
        socket.to(data.target).emit('offer', { sdp: data.sdp, from: socket.id });
    });
    
    socket.on('answer', (data) => {
        console.log(`📤 Answer от ${socket.id} к ${data.target}`);
        socket.to(data.target).emit('answer', { sdp: data.sdp, from: socket.id });
    });
    
    socket.on('ice-candidate', (data) => {
        socket.to(data.target).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
    });
    
    socket.on('end-call', () => {
        if (socket.roomId) {
            console.log(`📞 Завершение звонка в комнате ${socket.roomId} от ${socket.id}`);
            socket.to(socket.roomId).emit('call-ended');
            // Не удаляем комнату сразу, чтобы другой участник мог переподключиться
            // Удалим только через 5 секунд, если никто не переподключился
            setTimeout(() => {
                const room = activeRooms.get(socket.roomId);
                if (room && (!room.psychologist || !room.client)) {
                    console.log(`🗑️ Удаляем пустую комнату ${socket.roomId}`);
                    activeRooms.delete(socket.roomId);
                }
            }, 5000);
            socket.leave(socket.roomId);
            delete socket.roomId;
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`❌ Отключение сокета ${socket.id}`);
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner-disconnected');
            const room = activeRooms.get(socket.roomId);
            if (room) {
                room.users.delete(socket.id);
                if (socket.userType === 'psychologist') room.psychologist = null;
                else room.client = null;
                console.log(`📊 После отключения в комнате ${socket.roomId}: психолог=${room.psychologist}, клиент=${room.client}, users=${room.users.size}`);
                // Если комната пуста, удаляем через 10 секунд
                if (room.users.size === 0) {
                    setTimeout(() => {
                        const currentRoom = activeRooms.get(socket.roomId);
                        if (currentRoom && currentRoom.users.size === 0) {
                            console.log(`🗑️ Удаляем пустую комнату ${socket.roomId}`);
                            activeRooms.delete(socket.roomId);
                        }
                    }, 10000);
                }
            }
            socket.leave(socket.roomId);
        }
    });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Сервер запущен на порту ${PORT}`));