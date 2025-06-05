const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const app = express();
const port = 5000;
const dgram = require('dgram');
const { exec } = require('child_process');

// Флаг для определения режима разработки, переданный из главного процесса
const isDev = process.env.DEV_MODE === 'true';

// Обертки для консольного вывода
function devLog(...args) {
    if (isDev) {
        console.log(...args);
    }
}

function devError(...args) {
    if (isDev) {
        console.error(...args);
    }
}

function devWarn(...args) {
    if (isDev) {
        console.warn(...args);
    }
}

// Логирование всех входящих запросов
app.use((req, res, next) => {
    devLog(`[SERVER] ${new Date().toISOString()} ⇒ ${req.method} ${req.url}`);
    next();
});

// Массив для хранения активных клиентов
const activeClients = new Set();

// Функция для отправки списка клиентов в главный процесс Electron
function sendClientListToElectron() {
    if (process.send) { // Проверяем, запущен ли процесс как дочерний с IPC
        const clientIps = Array.from(activeClients).map(socket => socket.remoteAddress + ':' + socket.remotePort);
        process.send({ type: 'client-update', clients: clientIps });
    }
}

// Универсальный способ указания пути
// !!! ВАЖНО: Убедитесь, что этот путь указывает именно на папку с вашими данными,
// а не на папку проекта "browser", если они разные.
// Теперь CONTENT_PATH будет браться из переменной окружения, переданной Electron.
const CONTENT_PATH = process.env.CONTENT_PATH || path.join(__dirname, 'default_data_folder'); // Добавим путь по умолчанию на случай запуска без Electron

// Проверка существования пути при запуске
(async () => {
    try {
        await fs.access(CONTENT_PATH);
        devLog(`✓ Directory accessible: ${CONTENT_PATH}`);
    } catch (error) {
        devError(`× Error accessing directory: ${CONTENT_PATH}`);
        devError('Ensure:');
        devError(`1. Path "${CONTENT_PATH}" is correct`);
        devError('2. Directory exists');
        devError('3. No typos in the path');
        devError('Details of the error:', error.message);
        process.exit(1);
    }
})();

// Middleware для корректной обработки путей с пробелами и спецсимволами
app.use((req, res, next) => {
    // Декодируем URL-кодированные символы в пути
    try {
        // Декодируем только pathname, оставляя параметры запроса как есть (они обрабатываются express)
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        req.url = decodeURIComponent(parsedUrl.pathname) + parsedUrl.search; // Декодируем pathname и добавляем обратно параметры
    } catch (e) {
        // Обрабатываем ошибки неверного URL
        devError('Error decoding URL:', req.url, e);
        return res.status(400).send('Invalid URL encoding');
    }
    next();
});

// Обслуживание статических файлов
app.use('/files', express.static(CONTENT_PATH, {
    index: false,
    dotfiles: 'allow',
    setHeaders: (res, path) => {
        // Устанавливаем заголовки для CORS
        res.set('Access-Control-Allow-Origin', '*');
    }
}));

app.get('/api/list', async (req, res) => {
    try {
        // req.query.path уже декодирован благодаря middleware выше или express
        const dirPath = req.query.path || '/';
        // Убедимся, что dirPath начинается со слэша, если это не корень
        const normalizedDirPath = dirPath === '/' ? '/' : '/' + dirPath.replace(/^\//, '');

        const fullPath = path.join(CONTENT_PATH, normalizedDirPath);

        // Проверяем, что запрошенный путь находится внутри CONTENT_PATH
        // Нормализуем пути для сравнения
        const normalizedFullPath = path.normalize(fullPath);
        const normalizedContentPath = path.normalize(CONTENT_PATH);

        if (!normalizedFullPath.startsWith(normalizedContentPath)) {
             return res.status(403).json({ error: 'Access denied' });
        }

        const items = await fs.readdir(fullPath, { withFileTypes: true });
        const data = await Promise.all(items.map(async item => {
            // Формируем путь относительно корня CONTENT_PATH
            const itemPath = path.join(normalizedDirPath, item.name);
            const fullItemPath = path.join(fullPath, item.name);

            try {
                const stats = await fs.stat(fullItemPath);

                return {
                    name: item.name,
                    isDirectory: item.isDirectory(),
                    // Отправляем путь клиенту БЕЗ кодирования.
                    // Клиент получит путь с русскими символами/пробелами.
                    // Браузер/fetch закодируют его при запросе к /files.
                    // Удаляем ведущий слэш, чтобы path.join на клиенте работал корректно.
                    path: itemPath.replace(/\\/g, '/').replace(/^\//, ''),
                    size: stats.isDirectory() ? null : stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            } catch (statError) {
                // Игнорируем файлы, к которым нет доступа (EPERM, EACCES) или которые заняты (EBUSY)
                if (statError.code === 'EPERM' || statError.code === 'EACCES' || statError.code === 'EBUSY') {
                    devWarn(`[SERVER] Skipped inaccessible/busy file/directory: ${fullItemPath} (Error: ${statError.message})`);
                    return null; // Возвращаем null, чтобы отфильтровать позже
                } else {
                    // Перебрасываем другие неожиданные ошибки
                    throw statError;
                }
            }
        }));

        res.json(data.filter(item => item !== null).sort((a, b) => a.isDirectory === b.isDirectory ? 0 : a.isDirectory ? -1 : 1));
    } catch (error) {
        // Логируем ошибку на сервере
        devError(`Error in /api/list for path ${req.query.path}:`, error);
        res.status(500).json({ error: `Server error: ${error.message}` });
    }
});

// Новый endpoint для получения содержимого файлов (для текстовых файлов, CSV и т.д.)
app.get('/api/file-content', async (req, res) => {
    try {
        const relativeFilePath = req.query.path; // Путь относительно CONTENT_PATH (незакодированный)
        if (!relativeFilePath) {
            return res.status(400).send('Path parameter is missing');
        }
        
        // Составляем полный путь и нормализуем его
        const fullPath = path.join(CONTENT_PATH, relativeFilePath);
        const normalizedFullPath = path.normalize(fullPath);
        const normalizedContentPath = path.normalize(CONTENT_PATH);

        // Проверка безопасности: убеждаемся, что запрошенный файл находится внутри CONTENT_PATH
        if (!normalizedFullPath.startsWith(normalizedContentPath)) {
            devWarn(`Attempt to access file outside CONTENT_PATH: ${fullPath}`);
            return res.status(403).send('Access denied');
        }

        // Проверяем, что это файл, а не директория
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
             return res.status(400).send('Requested path is a directory');
        }

        // Чтение файла как текста (для TXT, CSV) или буфера (для DOCX, XLSX)
        // Определяем кодировку. Для большинства текстовых файлов подходит utf8.
        // Для бинарных файлов (docx, xlsx) читаем как буфер.
        const ext = path.extname(fullPath).toLowerCase();
        let content;
        if (['.txt', '.csv'].includes(ext)) {
             content = await fs.readFile(fullPath, 'utf8');
             res.setHeader('Content-Type', 'text/plain; charset=utf-8');
             res.send(content);
        } else if (['.docx', '.xlsx'].includes(ext)) {
             // Для docx/xlsx отправляем файл как есть для обработки на клиенте
             res.sendFile(fullPath);
        } else {
             // Для других типов предлагаем скачивание или отправляем как есть
             res.sendFile(fullPath);
        }

    } catch (error) {
        devError(`Error reading file ${req.query.path}:`, error);
        // Проверяем тип ошибки, чтобы вернуть более точный статус
        if (error.code === 'ENOENT') {
             res.status(404).send('File not found');
        } else if (error.code === 'EACCES') {
             res.status(403).send('File access error');
        } else {
             res.status(500).send(`Server error while reading file: ${error.message}`);
        }
    }
});

// Функция для рекурсивного поиска файлов
async function searchFilesRecursive(dir, term) {
    const results = [];
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (readdirError) {
        if (readdirError.code === 'EPERM' || readdirError.code === 'EACCES') {
            devWarn(`[SERVER] Skipped inaccessible directory: ${dir} (Error: ${readdirError.message})`);
            return results; // Возвращаем пустой массив для этой директории
        } else {
            throw readdirError;
        }
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(CONTENT_PATH, fullPath).replace(/\\/g, '/');
        
        try {
            // Проверяем, что это не символическая ссылка, которая может вызвать проблемы
            const stats = await fs.stat(fullPath);
            if (stats.isSymbolicLink()) {
                continue; // Пропускаем символические ссылки
            }

            if (entry.name.toLowerCase().includes(term.toLowerCase())) {
                results.push({
                    name: entry.name,
                    isDirectory: entry.isDirectory(),
                    path: relativePath,
                    size: entry.isDirectory() ? null : stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                });
            }
            
            if (entry.isDirectory()) {
                const subResults = await searchFilesRecursive(fullPath, term);
                results.push(...subResults);
            }
        } catch (statError) {
            // Игнорируем файлы, к которым нет доступа (EPERM, EACCES) или которые заняты (EBUSY)
            if (statError.code === 'EPERM' || statError.code === 'EACCES' || statError.code === 'EBUSY') {
                devWarn(`[SERVER] Skipped inaccessible/busy file/directory during search: ${fullPath} (Error: ${statError.message})`);
                continue; // Пропускаем этот элемент
            } else {
                throw statError;
            }
        }
    }
    
    return results;
}

// Endpoint для поиска файлов
app.get('/api/search', async (req, res) => {
    try {
        const term = req.query.term || '';
        if (!term.trim()) {
            return res.json([]);
        }
        
        const results = await searchFilesRecursive(CONTENT_PATH, term);
        res.json(results);
    } catch (error) {
        devError('File search error:', error);
        res.status(500).json({ error: 'File search error' });
    }
});

// Добавить новый endpoint для получения файла темы
app.get('/theme', (req, res) => {
    const theme = req.query.name || 'light';
    // В реальном приложении здесь должен быть безопасный механизм загрузки стилей,
    // чтобы избежать Path Traversal. Например, можно проверять, что `theme`
    // это 'light' или 'dark', и отправлять заранее определенные файлы.
    // Для простоты примера, просто отправляем файл.
    res.sendFile(path.join(__dirname, 'themes', `${theme}.css`));
});

// Endpoint для миниатюр
app.get('/api/thumbnail', async (req, res) => {
    try {
        devLog('Thumbnail request received.');
        const filePath = req.query.path;
        if (!filePath) {
            devWarn('Thumbnail request: Path parameter is missing.');
            return res.status(400).send('Path parameter is required');
        }

        devLog(`Thumbnail request for path: ${filePath}`);
        const fullPath = path.join(CONTENT_PATH, filePath);
        const normalizedFullPath = path.normalize(fullPath);
        const normalizedContentPath = path.normalize(CONTENT_PATH);

        devLog(`Full file path: ${fullPath}`);
        devLog(`Normalized full path: ${normalizedFullPath}`);
        devLog(`Normalized content path: ${normalizedContentPath}`);

        // Проверка безопасности
        if (!normalizedFullPath.startsWith(normalizedContentPath)) {
            devWarn(`Thumbnail request: Attempt to access file outside CONTENT_PATH: ${fullPath}`);
            return res.status(403).send('Access denied');
        }
        devLog('Thumbnail request: Security check passed.');

        // Проверяем, является ли файл изображением
        const ext = path.extname(fullPath).toLowerCase();
        devLog(`Расширение файла: ${ext}`);
        if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            devWarn(`Thumbnail request: File is not an image: ${fullPath}`);
            return res.status(400).send('File is not an image');
        }
        devLog('Thumbnail request: File is an image.');

        // Читаем файл и создаем миниатюру
        devLog('Thumbnail request: Reading file buffer...');
        const imageBuffer = await fs.readFile(fullPath);
        devLog(`Thumbnail request: File buffer read. Size: ${imageBuffer.length} bytes.`);

        devLog('Thumbnail request: Processing sharp...');
        const thumbnail = await sharp(imageBuffer)
            .resize(200, 200, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 80 })
            .toBuffer();
        devLog(`Thumbnail request: Thumbnail generated. Size: ${thumbnail.length} bytes.`);

        // Устанавливаем заголовки и отправляем
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=604800'); // Кэшируем на 1 неделю
        res.send(thumbnail);
        devLog('Thumbnail request: Thumbnail successfully sent.');

    } catch (error) {
        devError('Thumbnail generation error:', error);
        if (error.code === 'ENOENT') {
            res.status(404).send('File not found');
        } else if (error.code === 'EACCES') {
            res.status(403).send('Access denied to file');
        } else if (error.message.includes('Input buffer contains unsupported image format')) {
            res.status(400).send('Unsupported image format or corrupted file');
        } else {
            res.status(500).send(`Internal server error: ${error.message}`);
        }
    }
});

// Перехватываем соединения для отслеживания клиентов
const server = app.listen(port, () => {
    devLog(`Server started: http://localhost:${port}`);
});

server.on('connection', (socket) => {
    activeClients.add(socket);
    devLog(`[SERVER] Client connected: ${socket.remoteAddress}:${socket.remotePort}. Total clients: ${activeClients.size}`);
    sendClientListToElectron();

    socket.on('close', () => {
        activeClients.delete(socket);
        devLog(`[SERVER] Client disconnected: ${socket.remoteAddress}:${socket.remotePort}. Total clients: ${activeClients.size}`);
        sendClientListToElectron();
    });

    socket.on('error', (err) => {
        devError(`[SERVER] Client socket error: ${socket.remoteAddress}:${socket.remotePort}:`, err.message);
        // В случае ошибки сокета, возможно, клиент уже отключен, удаляем его
        activeClients.delete(socket);
        sendClientListToElectron();
    });
});

const udpServer = dgram.createSocket('udp4');
const UDP_PORT = 41234;

udpServer.on('message', (msg, rinfo) => {
    if (msg.toString() === 'DISCOVER_LOCALBROWSER_SERVER') {
        udpServer.send('LOCALBROWSER_SERVER_HERE', rinfo.port, rinfo.address);
    }
});
udpServer.bind(UDP_PORT, () => {
    devLog(`UDP discovery server started on port ${UDP_PORT}`);
});

// Открыть порт 41234 в брандмауэре Windows
function openFirewallPort() {
    if (process.platform === 'win32') {
        exec('powershell -Command "New-NetFirewallRule -DisplayName \\"LocalBrowser UDP Discovery\\" -Direction Inbound -Protocol UDP -LocalPort 41234 -Action Allow"', (err, stdout, stderr) => {
            if (err) {
                console.error('Ошибка открытия порта 41234 в брандмауэре:', stderr);
            } else {
                console.log('Порт 41234 открыт в брандмауэре Windows');
            }
        });
    }
}

// Удалить правило
function closeFirewallPort() {
    if (process.platform === 'win32') {
        exec('powershell -Command "Remove-NetFirewallRule -DisplayName \\"LocalBrowser UDP Discovery\\""', (err, stdout, stderr) => {
            if (err) {
                console.error('Ошибка удаления правила брандмауэра:', stderr);
            } else {
                console.log('Правило брандмауэра удалено');
            }
        });
    }
}

// Открываем порт при запуске
openFirewallPort();

// Удаляем правило при завершении процесса
process.on('exit', closeFirewallPort);
process.on('SIGINT', () => { closeFirewallPort(); process.exit(); });
process.on('SIGTERM', () => { closeFirewallPort(); process.exit(); });