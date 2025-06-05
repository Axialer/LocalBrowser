const { app, BrowserWindow } = require('electron');
const path = require('path');
const dgram = require('dgram');

let mainWindow;

app.whenReady().then(async () => {
    const serverIp = await discoverServer();
    createWindow(serverIp);
});

function createWindow(serverIp) {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            additionalArguments: serverIp ? [`--server-ip=${serverIp}`] : []
        }
    });

    mainWindow.loadFile('index.html');
}

function discoverServer() {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        client.bind(() => {
            client.setBroadcast(true);
            client.send('DISCOVER_LOCALBROWSER_SERVER', 41234, '255.255.255.255', (err) => {
                if (err) console.error('Ошибка отправки UDP:', err);
                else console.log('UDP broadcast отправлен');
            });
        });
        client.on('message', (msg, rinfo) => {
            const text = msg.toString();
            if (text.startsWith('LOCALBROWSER_SERVER_HERE:')) {
                const ip = text.split(':')[1];
                resolve(ip);
                client.close();
            }
        });
        setTimeout(() => {
            resolve(null); // Не найдено
            client.close();
        }, 2000);
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});