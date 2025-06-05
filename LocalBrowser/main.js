const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const dgram = require('dgram');
const { exec } = require('child_process');

let mainWindow;


app.whenReady().then(() => {
    createWindow();
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
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
                const ips = text.split(':')[1].split(',');
                console.log('Найдены IP-адреса сервера:', ips);
                dialog.showMessageBox({
                    type: 'question',
                    buttons: ips,
                    title: 'Выбор IP-адреса сервера',
                    message: 'Выберите IP-адрес сервера для подключения:',
                    defaultId: 0
                }).then(result => {
                    const selectedIp = ips[result.response];
                    resolve({ selectedIp, allIps: ips });
                    client.close();
                });
            }
        });
        setTimeout(() => {
            resolve(null); // Не найдено
            client.close();
        }, 2000);
    });
}

app.on('window-all-closed', () => {
    closeClientFirewallPort();
    if (process.platform !== 'darwin') app.quit();
});

process.on('exit', () => { closeClientFirewallPort(); });
process.on('SIGINT', () => { closeClientFirewallPort(); process.exit(); });
process.on('SIGTERM', () => { closeClientFirewallPort(); process.exit(); });