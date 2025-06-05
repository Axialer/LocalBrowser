const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');
const port = 5000;
const inboundRuleName = `LocalBrowserServer Inbound ${port}`;
const outboundRuleName = `LocalBrowserServer Outbound ${port}`;

// const isAdmin = require('is-admin'); // Удаляем эту строку полностью, так как используется динамический импорт

// Флаг для определения режима разработки
const isDev = !app.isPackaged;

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

let mainWindow;
let serverProcess;

let isQuitting = false; // Флаг для отслеживания процесса выхода
let firewallCleanupDone = false; // Флаг для дополнительной защиты от повторного выполнения

// Функция создания правила
function addFirewallRule(ruleName, port, direction) {
    return new Promise((resolve, reject) => {
        exec(`netsh advfirewall firewall add rule name="${ruleName}" dir=${direction} action=allow protocol=TCP localport=${port}`, 
        { timeout: 5000 }, (error) => {
            error ? reject(error) : resolve();
        });
    });
}

// Функция удаления правила
function removeFirewallRule(ruleName) {
    return new Promise((resolve, reject) => {
        exec(`netsh advfirewall firewall delete rule name="${ruleName}"`, 
        { timeout: 5000 }, (error, stdout, stderr) => {
            // Игнорируем ошибку "Правило не найдено"
            if (error) {
                if (error.code === 1) {
                    devLog(`Правило "${ruleName}" не найдено, пропускаем удаление`);
                    return resolve();
                }
                return reject(error);
            }
            resolve();
        });
    });
}

// Функция проверки существования правила
function firewallRuleExists(ruleName) {
    return new Promise((resolve) => {
        exec(`netsh advfirewall firewall show rule name="${ruleName}"`, 
        (error) => resolve(!error));
    });
}

// Функция для получения локального IP-адреса
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const interfaceName in interfaces) {
        const networkInterface = interfaces[interfaceName];
        for (const alias of networkInterface) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '127.0.0.1'; // Возвращаем localhost в качестве запасного варианта
}

// Функция для получения имени хоста
function getHostname() {
    return os.hostname();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, // Рекомендуется для безопасности
            nodeIntegration: false // Отключить Node.js в рендерере
        }
    });

    mainWindow.loadFile('index.html');

    // Открыть DevTools. (Убрать в продакшене)
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (serverProcess) {
            devLog('Останавливаю серверный процесс...');
            serverProcess.kill('SIGTERM'); // Или 'SIGKILL' если SIGTERM не работает
        }
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // Обработчик для запроса локального IP-адреса
    ipcMain.handle('get-local-ip', () => {
        return getLocalIpAddress();
    });

    // Обработчик для запроса имени хоста
    ipcMain.handle('get-hostname', () => {
        return getHostname();
    });

    // Обработчик для запроса выбора папки
    ipcMain.handle('select-directory', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // Обработчик для запуска сервера
    ipcMain.handle('start-server', async (event, contentPath) => {
        try {
            // Динамический импорт is-admin
            const { default: isAdmin } = await import('is-admin');
            const admin = await isAdmin();
            if (!admin) {
                throw new Error('Требуются права администратора для управления брандмауэром');
            }
            
            // Проверка и создание правил брандмауэра
            if (!(await firewallRuleExists(inboundRuleName))) {
                await addFirewallRule(inboundRuleName, port, 'in');
                mainWindow.webContents.send('server-log', `[INFO] Правило брандмауэра "${inboundRuleName}" добавлено.`);
            }
            if (!(await firewallRuleExists(outboundRuleName))) {
                await addFirewallRule(outboundRuleName, port, 'out');
                mainWindow.webContents.send('server-log', `[INFO] Правило брандмауэра "${outboundRuleName}" добавлено.`);
            }
        } catch (error) {
            console.error('Ошибка настройки брандмауэра:', error);
            mainWindow.webContents.send('server-log', `[ERROR] Ошибка настройки брандмауэра: ${error.message}`);
            return { success: false, message: `Ошибка настройки брандмауэра: ${error.message}` }; // Возвращаем ошибку, если нет прав
        }

        if (serverProcess) {
            devLog('Сервер уже запущен. Останавливаю...');
            serverProcess.kill('SIGTERM');
        }

        devLog(`Запускаю сервер с CONTENT_PATH: ${contentPath}`);
        // Запускаем server.js как дочерний процесс
        serverProcess = spawn('node', [path.join(__dirname, 'server.js')], {
            env: { ...process.env, CONTENT_PATH: contentPath, DEV_MODE: isDev ? 'true' : 'false' }, // Передаем DEV_MODE
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'] // IPC для обмена сообщениями
        });

        serverProcess.stdout.on('data', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-log', data.toString());
            }
        });

        serverProcess.stderr.on('data', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-log', `[ERROR] ${data.toString()}`);
            }
        });

        serverProcess.on('close', (code) => {
            devLog(`Серверный процесс завершился с кодом ${code}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-log', `[INFO] Сервер остановлен с кодом: ${code}`);
            }
            serverProcess = null;
        });

        serverProcess.on('error', (err) => {
            devError('Ошибка запуска серверного процесса:', err);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-log', `[ERROR] Ошибка запуска сервера: ${err.message}`);
            }
        });

        // Обработка IPC сообщений от дочернего процесса (server.js)
        serverProcess.on('message', (message) => {
            if (message.type === 'client-update') {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('client-list-update', message.clients);
                }
            }
        });

        return { success: true, message: 'Сервер запущен.' };
    });

    // Открываем порты при запуске
    openFirewallPort();      // UDP 41234
    openHttpFirewallPort();  // TCP 5000
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Добавляем обработчик перед закрытием приложения
app.on('before-quit', async (event) => {
    // Если уже в процессе выхода - игнорируем
    if (isQuitting || firewallCleanupDone) return; // Добавляем firewallCleanupDone
    isQuitting = true;
    firewallCleanupDone = true; // Устанавливаем флаг, что очистка началась
    
    // Отменяем немедленное закрытие, чтобы выполнить асинхронные операции
    event.preventDefault(); 

    try {
        devLog('Удаление правил брандмауэра...');
        await removeFirewallRule(inboundRuleName);
        await removeFirewallRule(outboundRuleName);
        devLog('Правила брандмауэра удалены');
        
        // Уведомляем рендерер, что правила удалены
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('server-log', `[INFO] Правила брандмауэра удалены.`);
        }
    } catch (error) {
        devError('Ошибка удаления правил брандмауэра:', error);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('server-log', `[ERROR] Ошибка удаления правил брандмауэра: ${error.message}`);
        }
    } finally {
        // Завершаем приложение после удаления правил (или попытки удаления)
        app.exit(0); // Используем app.exit(0) вместо app.quit()
    }

    // Удаляем правила при завершении процесса
    closeFirewallPort();
    closeHttpFirewallPort();
});

// Открыть порт 41234 в брандмауэре Windows
function openFirewallPort() {
    if (process.platform === 'win32') {
        exec('powershell -Command "New-NetFirewallRule -DisplayName \\"LocalBrowser UDP\\" -Direction Inbound -Protocol UDP -LocalPort 41234 -Action Allow"', (err, stdout, stderr) => {
            if (err) {
                console.error('Ошибка открытия порта 41234 в брандмауэре:', stderr);
            } else {
                console.log('Порт 41234 открыт в брандмауэре Windows');
            }
        });
    }
}

// Удалить правило для 41234
function closeFirewallPort() {
    if (process.platform === 'win32') {
        exec('powershell -Command "Remove-NetFirewallRule -DisplayName \\"LocalBrowser UDP\\""', (err, stdout, stderr) => {
            if (err) {
                console.error('Ошибка удаления правила брандмауэра (UDP):', stderr);
            } else {
                console.log('Правило брандмауэра (UDP) удалено');
            }
        });
    }
}

// Открыть порт 5000 в брандмауэре Windows
function openHttpFirewallPort() {
    if (process.platform === 'win32') {
        exec('powershell -Command "New-NetFirewallRule -DisplayName \\"LocalBrowser HTTP\\" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow"', (err, stdout, stderr) => {
            if (err) {
                console.error('Ошибка открытия порта 5000 в брандмауэре:', stderr);
            } else {
                console.log('Порт 5000 открыт в брандмауэре Windows');
            }
        });
    }
}

// Удалить правило для 5000
function closeHttpFirewallPort() {
    if (process.platform === 'win32') {
        exec('powershell -Command "Remove-NetFirewallRule -DisplayName \\"LocalBrowser HTTP\\""', (err, stdout, stderr) => {
            if (err) {
                console.error('Ошибка удаления правила брандмауэра (HTTP):', stderr);
            } else {
                console.log('Правило брандмауэра (HTTP) удалено');
            }
        });
    }
} 