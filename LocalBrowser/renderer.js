// Глобальные переменные
let currentPath = '';
let allFiles = [];

// Импорт необходимых модулей Node.js и библиотек
const fs = require('fs').promises; // Используем promises версию fs для асинхронности
const path = require('path');
const os = require('os'); // Импортируем модуль 'os'
const ExcelJS = require('exceljs'); // Импортируем exceljs

// Глобальная переменная для базового URL сервера
let SERVER_BASE_URL = localStorage.getItem('serverBaseUrl') || 'http://localhost:5000';

// Получаем IP сервера, если он был передан из main process
const serverIpArg = process.argv.find(arg => arg.startsWith('--server-ip='));
if (serverIpArg) {
    const ip = serverIpArg.split('=')[1];
    SERVER_BASE_URL = `http://${ip}:5000`;
    localStorage.setItem('serverBaseUrl', SERVER_BASE_URL);
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    // Загрузка корневой директории
    loadDirectory('/');
    
    // Обработчики событий
    document.getElementById('back').addEventListener('click', goBack);
    document.getElementById('close-viewer').addEventListener('click', closeViewer);
    document.getElementById('search').addEventListener('input', searchFiles);
    
    // Обработчики вкладок
    document.querySelectorAll('#fileTypeTabs .nav-link').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const type = tab.dataset.type;
            filterFilesByType(type);
            
            // Активируем вкладку
            document.querySelectorAll('#fileTypeTabs .nav-link').forEach(t => {
                t.classList.remove('active');
            });
            tab.classList.add('active');
        });
    });

    // Инициализация темы
    initTheme();
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    // Обработчики для панели настроек
    document.getElementById('settings-button').addEventListener('click', openSettings);
    document.getElementById('save-settings-button').addEventListener('click', saveSettings);
    document.getElementById('cancel-settings-button').addEventListener('click', closeSettings);

    // Загрузить IP-адреса при открытии настроек
    populateIPAddresses();
});

// Загрузка директории
async function loadDirectory(path = '') {
    try {
        console.log('[DEBUG] loadDirectory: Используется SERVER_BASE_URL:', SERVER_BASE_URL);
        currentPath = path;
        updateBreadcrumb(path);
        
        const response = await fetch(`${SERVER_BASE_URL}/api/list?path=${encodeURIComponent(path)}`);
        const files = await response.json();
        
        allFiles = files;
        renderFiles(files);
        
        // Скрываем просмотрщик, показываем сетку файлов
        closeViewer();
    } catch (error) {
        console.error('Error loading directory:', error);
        document.getElementById('no-files').classList.remove('d-none');
    }
}

// Обновление хлебных крошек
function updateBreadcrumb(path) {
    const breadcrumb = document.getElementById('breadcrumb');
    const parts = path.split('/').filter(p => p !== '');
    
    let html = '<ol class="breadcrumb mb-0">';
    html += '<li class="breadcrumb-item"><a href="#" data-path="/">Корень</a></li>';
    
    let accumulatedPath = '';
    for (let i = 0; i < parts.length; i++) {
        accumulatedPath += '/' + parts[i];
        html += `<li class="breadcrumb-item"><a href="#" data-path="${accumulatedPath}">${parts[i]}</a></li>`;
    }
    
    html += '</ol>';
    breadcrumb.innerHTML = html;
    
    // Добавляем обработчики на каждую ссылку
    breadcrumb.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            loadDirectory(a.dataset.path);
        });
    });
}

// Отображение файлов
function renderFiles(files) {
    const container = document.getElementById('files-grid');
    
    if (files.length === 0) {
        document.getElementById('no-files').classList.remove('d-none');
        container.innerHTML = '';
        return;
    }
    
    document.getElementById('no-files').classList.add('d-none');
    container.innerHTML = '';
    
    files.forEach(item => {
        const card = createFileCard(item);
        container.innerHTML += card;
    });
    
    // Добавляем обработчики на каждую карточку
    container.querySelectorAll('.file-card').forEach(card => {
        card.addEventListener('click', () => {
            const path = card.dataset.path;
            const item = files.find(f => f.path === path);
            if (item.isDirectory) {
                loadDirectory(path);
            } else {
                displayFile(item);
            }
        });
    });
}

// Создание карточки файла
function createFileCard(item) {
    const ext = item.name.split('.').pop().toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    const isVideo = ['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext);
    const isPDF = ext === 'pdf';
    const isDocument = ['doc', 'docx', 'xls', 'xlsx', 'txt', 'rtf', 'csv'].includes(ext); // Добавляем csv в список документов
    const isAudio = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma'].includes(ext); // Добавляем больше аудиоформатов
    
    let cardClass = 'folder-card';
    let icon = 'bi-folder'; // Эта переменная не используется в текущем шаблоне карточки
    let thumb = '';
    let fileType = 'folder';
    let sizeInfo = item.isDirectory ? 'Папка' : formatSize(item.size);
    
    if (!item.isDirectory) {
        if (isImage) {
            cardClass = 'image-card';
            icon = 'bi-image';
            const thumbnailUrl = `${SERVER_BASE_URL}/api/thumbnail?path=${encodeURIComponent('/' + item.path)}`;
            console.log('[DEBUG] Thumbnail URL generated:', thumbnailUrl);
            thumb = `
                <div class="file-thumb d-flex align-items-center justify-content-center">
                    <div class="loading-thumb w-100 h-100"></div>
                    <img src="${thumbnailUrl}" 
                         alt="${item.name}" 
                         class="img-thumbnail d-none" 
                         
                         onload="this.classList.remove('d-none'); this.previousElementSibling.remove()"
                         onerror="console.error('Ошибка загрузки миниатюры:', this.src); this.classList.remove('d-none'); if (this.previousElementSibling) this.previousElementSibling.remove();">
                </div>
            `;
            fileType = 'image';
        } else if (isVideo) {
            cardClass = 'video-card';
            icon = 'bi-film';
            thumb = `<div class="file-thumb video-thumb"><i class="bi bi-film" style="font-size: 3rem;"></i></div>`;
            fileType = 'video';
        } else if (isPDF) {
            cardClass = 'pdf-card';
            icon = 'bi-file-earmark-pdf';
            thumb = `<div class="file-thumb"><i class="bi bi-file-earmark-pdf" style="font-size: 3rem; color: var(--pdf-color);"></i></div>`;
            fileType = 'pdf';
        } else if (isDocument) {
            cardClass = 'document-card';
            icon = 'bi-file-earmark-text';
            // Определяем иконку по типу документа
            if (ext === 'doc' || ext === 'docx') {
                icon = 'bi-file-earmark-word';
            } else if (ext === 'xls' || ext === 'xlsx') {
                icon = 'bi-file-earmark-excel';
            } else if (ext === 'txt') {
                icon = 'bi-file-earmark-text';
            } else if (ext === 'rtf') {
                icon = 'bi-file-earmark-richtext';
            } else if (ext === 'csv') {
                 icon = 'bi-file-earmark-spreadsheet'; // Иконка для CSV
            }
            thumb = `<div class="file-thumb"><i class="bi ${icon}" style="font-size: 3rem; color: var(--document-color);"></i></div>`;
            fileType = 'document';
        } else if (isAudio) {
            cardClass = 'audio-card';
            icon = 'bi-file-earmark-music';
            thumb = `<div class="file-thumb audio-thumb"><i class="bi bi-file-earmark-music" style="font-size: 3rem; color: var(--audio-color);"></i></div>`;
            fileType = 'audio';
        } else {
            // Общий случай для других файлов
            cardClass = 'document-card'; // Можно использовать более общий класс
            icon = 'bi-file-earmark';
            thumb = `<div class="file-thumb"><i class="bi ${icon}" style="font-size: 3rem; color: var(--document-color);"></i></div>`;
            fileType = 'other';
        }
    } else {
        // Для папок
        thumb = `<div class="file-thumb d-flex align-items-center justify-content-center"><i class="bi bi-folder" style="font-size: 4rem; color: var(--folder-color);"></i></div>`;
        fileType = 'folder';
    }
    
    return `
        <div class="col">
            <div class="card file-card ${cardClass}" data-path="${item.path}" data-type="${fileType}">
                ${thumb}
                <div class="card-body">
                    <h6 class="card-title mb-1">${item.name}</h6>
                    <p class="card-text text-muted small">${sizeInfo}</p>
                </div>
            </div>
        </div>
    `;
}

// Отображение содержимого файла
async function displayFile(item) {
    console.log('[DEBUG] Функция displayFile вызвана для файла:', item.name, 'с путем:', item.path);
    console.log('item.name:', item.name); // Лог имени файла
    console.log('item.path (from server):', item.path); // Лог пути от сервера (теперь незакодированный)

    const viewer = document.getElementById('media-viewer');
    const viewerContent = document.getElementById('viewer-content');
    const viewerTitle = document.getElementById('viewer-title');
    const viewerHeader = document.getElementById('viewer-header'); // Получаем заголовок просмотрщика

    // Проверяем, что элементы просмотрщика найдены
    if (!viewer || !viewerContent || !viewerTitle || !viewerHeader) {
        console.error("Ошибка: Не найдены элементы просмотрщика в DOM.");
        // Можно добавить fallback или просто выйти из функции
        return;
    }

    // Обрезаем название файла, если оно слишком длинное
    const maxTitleLength = 50; // Максимальная длина названия файла перед обрезкой
    const truncatedTitle = item.name.length > maxTitleLength
        ? item.name.substring(0, maxTitleLength) + '...'
        : item.name;
    viewerTitle.textContent = truncatedTitle; // Устанавливаем обрезанное название

    viewerContent.innerHTML = ''; // Очищаем предыдущее содержимое

    // Убираем фиксированную высоту и прокрутку дляviewerContent
    viewerContent.style.maxHeight = 'none';
    viewerContent.style.overflow = 'visible';

    const ext = item.name.split('.').pop().toLowerCase();

    // item.path приходит незакодированным от сервера и без ведущего слэша.
    // Используем его напрямую для формирования локального пути и пути для сервера.
    const decodedItemPath = item.path; // Путь уже декодирован (или никогда не был закодирован)
    console.log('item.path (used directly):', decodedItemPath); // Лог пути

    // filePath для доступа через сервер (для img, video, pdf, download, txt, csv, docx, xlsx)
    // Используем encodeURI() для корректной обработки спецсимволов и пробелов в URL при запросах к серверу
    const encodedFilePath = encodeURI(`/files/${decodedItemPath}`);
    const fileAccessUrl = `${SERVER_BASE_URL}${encodedFilePath}`;
    console.log('fileAccessUrl (for server access):', fileAccessUrl); // Лог пути для сервера

    // Добавляем кнопку скачивания в заголовок просмотрщика
    // Сначала удалим старую кнопку, если она есть
    const existingDownloadButton = viewerHeader.querySelector('.download-button');
    if (existingDownloadButton) {
        existingDownloadButton.remove();
    }

    // Создаем новую кнопку скачивания
    const downloadButton = document.createElement('a');
    downloadButton.href = fileAccessUrl; // Ссылка на файл через сервер (используем fileAccessUrl)
    downloadButton.download = item.name; // Атрибут download заставляет браузер скачать файл
    downloadButton.className = 'btn btn-secondary btn-sm ms-2 download-button'; // Классы Bootstrap и свой класс
    downloadButton.innerHTML = '<i class="bi bi-download me-1"></i> Скачать'; // Иконка и текст
    downloadButton.setAttribute('title', `Скачать файл "${item.name}"`); // Подсказка при наведении

    // Находим кнопку закрытия и вставляем кнопку скачивания перед ней
    const closeButton = viewerHeader.querySelector('#close-viewer');
    if (closeButton) {
        viewerHeader.insertBefore(downloadButton, closeButton);
    } else {
        // Если кнопка закрытия не найдена, добавим в конец заголовка
        viewerHeader.appendChild(downloadButton);
        console.error("Элемент #close-viewer не найден внутри #viewer-header.");
    }

    // Отображение содержимого в зависимости от типа файла
    try {
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            // Для изображений создаем контейнер с автоматическим размером
            viewerContent.innerHTML = `
                <div class="d-flex justify-content-center">
                    <img src="${fileAccessUrl}" class="img-contain" alt="${item.name}" 
                         onload="adjustImageSize(this)">
                </div>
            `;
        } else if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext)) {
            // Для видео
            viewerContent.innerHTML = `
                <div class="d-flex justify-content-center">
                    <video controls src="${fileAccessUrl}" class="video-contain"></video>
                </div>
            `;
        } else if (ext === 'mp3') {
            // Для MP3
            viewerContent.innerHTML = `
                <div class="d-flex justify-content-center">
                    <audio controls src="${fileAccessUrl}" class="audio-player"></audio>
                </div>
            `;
        } else if (ext === 'pdf') {
            // Для PDF сохраняем прокрутку внутри фрейма
            viewerContent.innerHTML = `
                <div class="pdf-container">
                    <iframe src="${fileAccessUrl}" class="pdf-frame"></iframe>
                </div>
            `;
        } else if (['txt'].includes(ext)) {
            // Для текстовых файлов запрашиваем содержимое с нового API endpoint
            const response = await fetch(`${SERVER_BASE_URL}/api/file-content?path=${encodeURIComponent(decodedItemPath)}`);
            if (!response.ok) {
                throw new Error(`Сервер вернул статус: ${response.status}`);
            }
            const content = await response.text();
            viewerContent.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
        } else if (['csv'].includes(ext)) {
             // Для CSV запрашиваем содержимое с нового API endpoint
            const response = await fetch(`${SERVER_BASE_URL}/api/file-content?path=${encodeURIComponent(decodedItemPath)}`);
             if (!response.ok) {
                 throw new Error(`Сервер вернул статус: ${response.status}`);
             }
            const content = await response.text();
            viewerContent.innerHTML = csvToHtmlTable(content);
        } else if (['docx'].includes(ext)) {
             // Для DOCX используем библиотеку docx-preview, загружая файл через сервер
             const response = await fetch(fileAccessUrl); // Запрос файла через /files
             if (!response.ok) {
                 throw new Error(`Сервер вернул статус: ${response.status}`);
             }
             const data = await response.blob(); // Получаем данные как Blob
             
             if (window.docx) { // Проверяем, загружена ли библиотека docx-preview
                 const container = document.createElement('div');
                 // Добавляем классы для стилизации и скролла
                 container.className = 'docx-preview'; 
                 viewerContent.appendChild(container);
                 
                 // Создаем FileReader для чтения Blob как ArrayBuffer
                 const reader = new FileReader();
                 reader.onloadend = async () => {
                     try {
                         // reader.result будет ArrayBuffer
                         await window.docx.renderAsync(reader.result, container, null, { // Используем window.docx
                             className: "docx", // Класс для стилизации
                             inWrapper: true, // Оборачивает содержимое
                             ignoreWidth: false, // Учитывает ширину
                             ignoreHeight: false, // Учитывает высоту
                             breakPages: true, // Разрывы страниц
                             sizeUnit: "px", // Единицы измерения размера
                             nbPages: Infinity // Максимальное количество страниц
                         });
                         // Добавляем обработчик клика для изображений внутри DOCX
                         container.querySelectorAll('img').forEach(img => {
                             img.style.cursor = 'pointer';
                             img.onclick = () => window.open(img.src, '_blank');
                         });

                     } catch (renderError) {
                         console.error("Ошибка рендеринга DOCX:", renderError);
                         container.innerHTML = `<div class="alert alert-danger">Ошибка рендеринга DOCX: ${renderError.message}</div>`;
                     }
                 };
                 // Читаем Blob как ArrayBuffer
                 reader.readAsArrayBuffer(data);

             } else {
                  viewerContent.innerHTML = `<div class="alert alert-warning">Библиотека docx-preview не загружена.</div>`;
                  console.error("Библиотека docx-preview (window.docx) не найдена.");
             }
        } else if (['xlsx'].includes(ext)) {
             // Для XLSX используем библиотеку exceljs, загружая файл через сервер
             const response = await fetch(fileAccessUrl); // Запрос файла через /files
             if (!response.ok) {
                 throw new Error(`Сервер вернул статус: ${response.status}`);
             }
             const data = await response.blob(); // Получаем данные как Blob
             
             try {
                 // Создаем FileReader для чтения Blob как ArrayBuffer
                 const reader = new FileReader();
                 reader.onloadend = async () => {
                      try {
                          // reader.result будет ArrayBuffer
                          const workbook = new ExcelJS.Workbook();
                          await workbook.xlsx.load(reader.result); // Загружаем из ArrayBuffer
                          viewerContent.innerHTML = excelToHtmlTable(workbook);
                      } catch (parseError) {
                          console.error("Ошибка парсинга XLSX:", parseError);
                          viewerContent.innerHTML = `<div class="alert alert-danger">Ошибка парсинга XLSX: ${parseError.message}</div>`;
                      }
                 };
                 // Читаем Blob как ArrayBuffer
                 reader.readAsArrayBuffer(data);

             } catch (error) {
                 console.error("Ошибка загрузки XLSX файла:", error);
                 viewerContent.innerHTML = `<div class="alert alert-danger">Ошибка загрузки XLSX: ${error.message}</div>`;
             }
        }
         else {
            // Для других типов файлов предлагаем только скачивание
            viewerContent.innerHTML = `
                <div class="alert alert-info text-center">
                    Предпросмотр для файлов типа ".${ext}" не поддерживается.<br>
                    <a href="${fileAccessUrl}" class="btn btn-primary mt-2" download="${item.name}">
                         <i class="bi bi-download me-1"></i> Скачать файл
                    </a>
                </div>
            `;
            // Автоматически кликаем по кнопке скачивания, чтобы предложить скачать
            // downloadButton.click(); // Закомментируем автоматический клик, чтобы не было неожиданного скачивания
        }

        // Показываем просмотрщик после загрузки содержимого
        viewer.classList.remove('d-none');
        document.getElementById('files-grid').classList.add('d-none');

    } catch (error) {
        console.error(`Ошибка при отображении файла ${item.name}:`, error);
        viewerContent.innerHTML = `
            <div class="alert alert-danger">
                Не удалось отобразить файл: ${item.name}<br>
                <small>${error.message}</small>
            </div>
        `;
         // Показываем просмотрщик даже при ошибке, чтобы показать сообщение
        viewer.classList.remove('d-none');
        document.getElementById('files-grid').classList.add('d-none');
    }
}

// Конвертация CSV в HTML таблицу
function csvToHtmlTable(csvData) {
    try {
        const lines = csvData.split(/\r\n|\n/);
        let html = '<table class="table table-bordered table-sm"><thead><tr>';

        // Заголовки (первая строка)
        const headers = lines[0].split(',');
        headers.forEach(header => {
            html += `<th>${escapeHtml(header)}</th>`;
        });
        html += '</tr></thead><tbody>';

        // Строки данных
        for (let i = 1; i < lines.length; i++) {
            const cells = lines[i].split(',');
            if (cells.length === headers.length) { // Проверяем, что количество ячеек совпадает с заголовками
                html += '<tr>';
                cells.forEach(cell => {
                    html += `<td>${escapeHtml(cell)}</td>`;
                });
                html += '</tr>';
            }
        }

        html += '</tbody></table>';
        return html;
    } catch (error) {
        console.error("Ошибка конвертации CSV в HTML:", error);
        return `<div class="alert alert-warning">Ошибка обработки CSV: ${error.message}</div>`;
    }
}

// Конвертация Excel (ExcelJS Workbook) в HTML таблицу
function excelToHtmlTable(workbook) {
    let html = '';
    try {
        workbook.eachSheet((sheet, id) => {
            html += `<h5>${escapeHtml(sheet.name)}</h5>`;
            html += '<table class="table table-bordered table-sm"><tbody>';

            sheet.eachRow((row, rowNumber) => {
                html += '<tr>';
                row.eachCell((cell, colNumber) => {
                    // Используем cell.value для получения значения
                    const cellValue = cell.value === null ? '' : cell.value;
                    html += `<td>${escapeHtml(cellValue.toString())}</td>`;
                });
                html += '</tr>';
            });

            html += '</tbody></table>';
        });
        return html;
    } catch (error) {
        console.error("Ошибка конвертации Excel в HTML:", error);
        return `<div class="alert alert-warning">Ошибка обработки Excel: ${error.message}</div>`;
    }
}

// Фильтрация по типу файлов
function filterFilesByType(type) {
    if (type === 'all') {
        renderFiles(allFiles);
        return;
    }
    
    const filteredFiles = allFiles.filter(item => {
        if (type === 'documents') {
            const ext = item.name.split('.').pop().toLowerCase();
            return !item.isDirectory && ![
                'jpg','jpeg','png','gif','webp',
                'mp4','webm','mkv','avi','mov','pdf'
            ].includes(ext);
        }
        
        if (type === 'video') {
            const ext = item.name.split('.').pop().toLowerCase();
            return !item.isDirectory && ['mp4','webm','mkv','avi','mov'].includes(ext);
        }
        
        if (type === 'image') {
            const ext = item.name.split('.').pop().toLowerCase();
            return !item.isDirectory && ['jpg','jpeg','png','gif','webp'].includes(ext);
        }
        
        if (type === 'pdf') {
            const ext = item.name.split('.').pop().toLowerCase();
            return !item.isDirectory && ext === 'pdf';
        }
        
        if (type === 'audio') {
            const ext = item.name.split('.').pop().toLowerCase();
            return !item.isDirectory && ['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma'].includes(ext);
        }
        
        return false;
    });
    
    renderFiles(filteredFiles);
}

let searchTimeout;

async function searchFiles(e) {
    const term = e.target.value.trim();
    
    clearTimeout(searchTimeout);
    
    if (term === '') {
        renderFiles(allFiles);
        return;
    }
    
    // Используем debounce для оптимизации
    searchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${SERVER_BASE_URL}/api/search?term=${encodeURIComponent(term)}`);
            const results = await response.json();
            renderFiles(results);
        } catch (error) {
            console.error('Ошибка поиска:', error);
            // Отображаем сообщение об ошибке
            const container = document.getElementById('files-grid');
            container.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger">
                        Ошибка поиска: ${error.message}
                    </div>
                </div>
            `;
        }
    }, 300);
}

// Навигация назад
function goBack() {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(p => p !== '');
    parts.pop();
    const newPath = parts.length > 0 ? '/' + parts.join('/') : '/';
    loadDirectory(newPath);
}

// Закрыть просмотрщик
function closeViewer() {
    document.getElementById('media-viewer').classList.add('d-none');
    document.getElementById('files-grid').classList.remove('d-none');
}

// Форматирование размера файла
function formatSize(bytes) {
    if (bytes === null || bytes === undefined) return '';
    if (bytes < 1024) return bytes + ' Bi';
    const sizes = ['By', 'KB', 'MB', 'GB'];
    let i = 0;


    while (bytes >= 1024 && i < sizes.length) {
        bytes /= 1024;
        i++;
    }

    return bytes.toFixed(2) + ' ' + sizes[i];
}

// Экранирование HTML
function escapeHtml(text) {
    if (typeof text !== 'string') {
        // Преобразуем в строку, если это не null/undefined, иначе пустая строка
        text = (text === null || text === undefined) ? '' : text.toString();
    }
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Добавить новую функцию для автоматической регулировки размера
function adjustImageSize(img) {
    // const container = document.getElementById('viewer-content'); // Не используется напрямую
    // const viewer = document.getElementById('media-viewer'); // Не используется напрямую
    
    // Рассчитываем максимальные размеры
    const maxWidth = window.innerWidth * 0.9;
    const maxHeight = window.innerHeight * 0.8;
    
    // Определяем ориентацию
    const isPortrait = img.naturalHeight > img.naturalWidth;
    
    if (isPortrait) {
        // Вертикальное изображение - ограничиваем по высоте
        img.style.maxHeight = `${maxHeight}px`;
        img.style.width = 'auto';
    } else {
        // Горизонтальное изображение - ограничиваем по ширине
        img.style.maxWidth = `${maxWidth}px`;
        img.style.height = 'auto';
    }
    
    // Центрируем изображение
    img.style.display = 'block';
    img.style.margin = '0 auto';
}

// Добавить в конец файла
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.classList.toggle('dark-theme', savedTheme === 'dark');
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    const newTheme = isDark ? 'dark' : 'light';
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const icon = theme === 'dark' ? 'bi-sun' : 'bi-moon';
    document.getElementById('theme-toggle').innerHTML = `<i class="bi ${icon}"></i>`;
}

// Функции для панели настроек
function openSettings() {
    document.getElementById('settings-panel').classList.remove('d-none');
    document.getElementById('files-grid').classList.add('d-none');
    document.getElementById('media-viewer').classList.add('d-none');
    document.getElementById('no-files').classList.add('d-none');
    document.getElementById('search').value = ''; // Очищаем поле поиска
    filterFilesByType('all'); // Сбрасываем фильтры
    populateIPAddresses(); // Обновляем список IP-адресов каждый раз при открытии
}

function closeSettings() {
    document.getElementById('settings-panel').classList.add('d-none');
    // Возвращаемся к последнему состоянию (файлы или просмотрщик)
    if (document.getElementById('media-viewer').classList.contains('d-none')) {
        document.getElementById('files-grid').classList.remove('d-none');
    } else {
        document.getElementById('media-viewer').classList.remove('d-none');
    }
}

async function populateIPAddresses() {
    const select = document.getElementById('ip-address-select');
    select.innerHTML = ''; // Очищаем предыдущие опции

    // Добавляем опцию для localhost
    const localhostOption = document.createElement('option');
    localhostOption.value = 'http://localhost:5000';
    localhostOption.textContent = 'http://localhost:5000 (Локальный)';
    select.appendChild(localhostOption);

    // Получаем локальные IP-адреса и имя хоста
    const hostname = os.hostname(); // Получаем имя хоста
    const interfaces = os.networkInterfaces();
    const ips = [];

    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            // Фильтруем IPv4 и не-внутренние адреса
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }

    // Добавляем каждый IP-адрес как опцию
    ips.forEach(ip => {
        const option = document.createElement('option');
        option.value = `http://${ip}:5000`;
        option.textContent = `http://${ip}:5000 (${hostname})`; // Добавляем имя хоста в скобках
        select.appendChild(option);
    });

    // Выбираем текущий SERVER_BASE_URL
    select.value = SERVER_BASE_URL;
}

function saveSettings() {
    const select = document.getElementById('ip-address-select');
    SERVER_BASE_URL = select.value;
    localStorage.setItem('serverBaseUrl', SERVER_BASE_URL);
    // Убираем alert и сразу пытаемся загрузить директорию
    // alert(`Базовый URL сервера установлен на: ${SERVER_BASE_URL}. Перезагрузите приложение для применения изменений.`);
    closeSettings();
    loadDirectory(currentPath); // Немедленно перезагружаем директорию с новым URL
}

