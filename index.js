const { tasks } = require('@googleapis/tasks');
const { OAuth2Client } = require('google-auth-library');
const { createCanvas, registerFont } = require('canvas');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// --- Configuración de Google OAuth2 ---
// El usuario debe proporcionar credentials.json descargado de Google Cloud Console.
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/tasks.readonly'];

// --- Argumentos de Stream Deck ---
const args = process.argv;
const port = args[args.findIndex(a => a === '-port') + 1];
const uuid = args[args.findIndex(a => a === '-pluginUUID') + 1];
const registerEvent = args[args.findIndex(a => a === '-registerEvent') + 1];

let ws = new WebSocket(`ws://127.0.0.1:${port}`);
let actions = new Map(); // Mapa para seguir las instancias de acciones y sus configuraciones

// --- Lógica de Autenticación de Google ---
async function getAuthenticatedClient() {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.error('--- ERROR: credentials.json NO ENCONTRADO ---');
        console.error('1. Ve a https://console.cloud.google.com/');
        console.error('2. Habilita "Google Tasks API".');
        console.error('3. Crea un "OAuth 2.0 Client ID" (Desktop).');
        console.error('4. Descarga el JSON y renombralo a "credentials.json" en esta carpeta.');
        return null;
    }
    const content = fs.readFileSync(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const auth = new OAuth2Client(key.client_id, key.client_secret, key.redirect_uris[0]);

    if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH);
        auth.setCredentials(JSON.parse(token));
        return auth;
    }

    // Si no hay token, el plugin debería manejar el flujo, pero para simplificar
    // instruimos al usuario a generar el token inicialmente.
    console.error('Error: token.json no encontrado. Ejecuta un script de autenticación primero.');
    return null;
}

// --- Lógica de Renderizado Canvas ---
function drawTaskImage(text, settings) {
    const { fontFamily = 'Arial', fontSize = 12, maxCharsPerLine = 10 } = settings;
    const canvas = createCanvas(72, 72);
    const ctx = canvas.getContext('2d');

    // Fondo negro
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 72, 72);

    // Configuración de texto
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `${fontSize}px "${fontFamily}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word Wrap
    const words = text.split(' ');
    let lines = [];
    let currentLine = '';

    for (let word of words) {
        if ((currentLine + word).length <= maxCharsPerLine) {
            currentLine += (currentLine ? ' ' : '') + word;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) lines.push(currentLine);

    // Dibujar líneas centradas verticalmente
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    let startY = (72 - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, i) => {
        ctx.fillText(line, 36, startY + (i * lineHeight));
    });

    return canvas.toBuffer('image/png').toString('base64');
}

// --- Lógica de Negocio: Obtener Tarea ---
async function updateTask(context, settings) {
    const auth = await getAuthenticatedClient();
    if (!auth) return;

    const tasksClient = tasks({ version: 'v1', auth });
    const taskIndex = parseInt(settings.taskIndex || 1) - 1;

    try {
        const res = await tasksClient.tasklists.list({ maxResults: 1 });
        if (!res.data.items || res.data.items.length === 0) return;

        const listId = res.data.items[0].id;
        const tasksRes = await tasksClient.tasks.list({
            tasklist: listId,
            showCompleted: false,
            maxResults: 10 // Ajustable
        });

        const tasks = tasksRes.data.items || [];
        if (tasks[taskIndex]) {
            const taskTitle = tasks[taskIndex].title;
            const base64Image = drawTaskImage(taskTitle, settings);

            ws.send(JSON.stringify({
                event: 'setImage',
                context: context,
                payload: {
                    image: `data:image/png;base64,${base64Image}`,
                    target: 0
                }
            }));
        }
    } catch (err) {
        console.error('Error al obtener tareas:', err);
    }
}

// --- WebSocket Handlers ---
ws.on('open', () => {
    ws.send(JSON.stringify({
        event: registerEvent,
        uuid: uuid
    }));
});

ws.on('message', (data) => {
    const json = JSON.parse(data);
    const { event, context, payload } = json;

    if (event === 'willAppear') {
        const settings = payload.settings || {};
        actions.set(context, settings);
        updateTask(context, settings);
    }

    if (event === 'didReceiveSettings') {
        const settings = payload.settings;
        actions.set(context, settings);
        updateTask(context, settings);
    }
});

// Polling cada 5 minutos
setInterval(() => {
    actions.forEach((settings, context) => {
        updateTask(context, settings);
    });
}, 5 * 60 * 1000);
