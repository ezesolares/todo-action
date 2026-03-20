const { tasks } = require('@googleapis/tasks');
const { exec } = require('child_process');
const { OAuth2Client } = require('google-auth-library');
const { createCanvas, registerFont } = require('canvas');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// --- Configuración de Google OAuth2 ---
// El usuario debe proporcionar credentials.json descargado de Google Cloud Console.
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/tasks'];

// --- Argumentos de Stream Deck ---
const args = process.argv;
const port = args[args.findIndex(a => a === '-port') + 1];
const uuid = args[args.findIndex(a => a === '-pluginUUID') + 1];
const registerEvent = args[args.findIndex(a => a === '-registerEvent') + 1];

let ws = new WebSocket(`ws://127.0.0.1:${port}`);
let actions = new Map(); // Mapa para seguir las instancias de acciones y sus configuraciones
let currentTasksData = new Map(); // Mapa para guardar los datos de la tarea actual por context

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
    const { fontFamily = 'Verdana', fontSize = 12, maxCharsPerLine = 10 } = settings;
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

    // Character-based wrapping
    const maxChars = parseInt(maxCharsPerLine);
    let lines = [];
    for (let i = 0; i < text.length; i += maxChars) {
        lines.push(text.substring(i, i + maxChars));
    }

    // Dibujar líneas centradas verticalmente
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    let startY = (72 - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, i) => {
        ctx.fillText(line, 36, startY + (i * lineHeight));
    });

    return canvas.toBuffer('image/png').toString('base64');
}

let lastRenderedData = new Map(); // Cache para evitar re-renderizados innecesarios

// --- Lógica de Negocio: Obtener Tarea ---
async function updateTask(context, settings, force = false) {
    const auth = await getAuthenticatedClient();
    if (!auth) return;

    const tasksClient = tasks({ version: 'v1', auth });
    const taskIndex = parseInt(settings.taskIndex || 1) - 1;
    const listId = settings.listId || null;
    const onlyOpenTasks = settings.onlyOpenTasks === undefined ? true : (settings.onlyOpenTasks === 'true' || settings.onlyOpenTasks === true);

    try {
        let selectedListId = listId;

        // Si no hay lista seleccionada, buscamos la primera lista disponible
        if (!selectedListId) {
            const res = await tasksClient.tasklists.list({ maxResults: 1 });
            if (!res.data.items || res.data.items.length === 0) return;
            selectedListId = res.data.items[0].id;
        }

        const tasksRes = await tasksClient.tasks.list({
            tasklist: selectedListId,
            showCompleted: !onlyOpenTasks,
            showHidden: false,
            maxResults: 100 // Aumentamos para poder ordenar una lista mayor
        });

        let taskItems = tasksRes.data.items || [];

        // --- Lógica de Sorteo por Prioridad (IMP: X) ---
        taskItems.sort((a, b) => {
            const priorityRegex = /IMP:\s*(\d+)/i;
            
            const matchA = (a.notes || '').match(priorityRegex);
            const matchB = (b.notes || '').match(priorityRegex);
            
            const pA = matchA ? parseInt(matchA[1]) : Infinity;
            const pB = matchB ? parseInt(matchB[1]) : Infinity;
            
            if (pA !== pB) {
                return pA - pB; // Menor número = mayor prioridad
            }
            
            // Si tienen la misma prioridad (o ninguna), mantenemos el orden original del API
            return 0;
        });

        const task = taskItems[taskIndex] || { id: 'none', title: taskItems.length > 0 ? 'Índice fuera' : 'Sin tareas' };
        const taskTitle = task.title;

        // Comprobar si algo ha cambiado antes de renderizar
        const renderSettings = {
            fontFamily: settings.fontFamily || 'Verdana',
            fontSize: settings.fontSize || 12,
            maxCharsPerLine: settings.maxCharsPerLine || 10
        };
        const cacheKey = JSON.stringify({ 
            taskId: task.id, 
            title: taskTitle, 
            taskIndex: settings.taskIndex,
            listId: settings.listId,
            onlyOpen: settings.onlyOpenTasks,
            ...renderSettings 
        });
        
        if (!force && lastRenderedData.get(context) === cacheKey) {
            // No hay cambios, no renderizamos
            return;
        }

        // Guardar datos para el editor
        if (task.id !== 'none') {
            currentTasksData.set(context, {
                id: task.id,
                title: taskTitle,
                listId: selectedListId
            });
        }

        const base64Image = drawTaskImage(taskTitle, settings);

        ws.send(JSON.stringify({
            event: 'setImage',
            context: context,
            payload: {
                image: `data:image/png;base64,${base64Image}`,
                target: 0
            }
        }));

        // Actualizar cache
        lastRenderedData.set(context, cacheKey);

    } catch (err) {
        console.error('Error al obtener tareas:', err);
    }
}

async function fetchAndSendLists(context) {
    const auth = await getAuthenticatedClient();
    if (!auth) return;

    try {
        const tasksClient = tasks({ version: 'v1', auth });
        const res = await tasksClient.tasklists.list();
        const lists = (res.data.items || []).map(l => ({ id: l.id, title: l.title }));

        ws.send(JSON.stringify({
            event: 'sendToPropertyInspector',
            context: context,
            payload: {
                lists: lists
            }
        }));
    } catch (err) {
        console.error('Error al obtener listas:', err);
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
        updateTask(context, settings, true); // Forzar renderizado inicial
    }

    if (event === 'didReceiveSettings') {
        const settings = payload.settings;
        actions.set(context, settings);
        updateTask(context, settings, true); // Forzar cuando se cambian ajustes
    }

    if (event === 'propertyInspectorDidAppear') {
        fetchAndSendLists(context);
    }

    if (event === 'keyDown') {
        const taskData = currentTasksData.get(context);
        if (!taskData) {
            exec(`zenity --error --title="Google Tasks" --text="No hay datos de la tarea para este botón. Espera a que se refresque."`);
            return;
        }

        // Dialogo único con Zenity
        const sanitizedTitle = taskData.title.replace(/"/g, '\\"');
        const cmd = `zenity --entry --title="Gestionar Tarea" --text="Modifica el título o marca como completada:" --entry-text="${sanitizedTitle}" --ok-label="Actualizar Texto" --extra-button="Completada" --cancel-label="Cancelar"`;

        exec(cmd, async (err, stdout) => {
            const result = stdout.trim();
            console.log(`[Zenity] Salida del diálogo: "${result}"`);

            if (err && !result) {
                console.log(`[Zenity] Diálogo cancelado o error real: ${err.message}`);
                return;
            }
            
            let newTitle = taskData.title;
            let finalStatus = 'needsAction';

            if (result === 'Completada') {
                finalStatus = 'completed';
                console.log(`[Update] Marcando tarea como COMPLETADA: ${taskData.id}`);
            } else if (result) {
                newTitle = result;
                console.log(`[Update] Actualizando título a: "${newTitle}" para la tarea: ${taskData.id}`);
            } else {
                return; // Caso borde
            }
            
            const auth = await getAuthenticatedClient();
            if (auth) {
                try {
                    const tasksClient = tasks({ version: 'v1', auth });
                    console.log(`[API] Llamando a tasks.patch para tasklist: ${taskData.listId}, task: ${taskData.id}`);
                    const patchRes = await tasksClient.tasks.patch({
                        tasklist: taskData.listId,
                        task: taskData.id,
                        requestBody: {
                            title: newTitle,
                            status: finalStatus,
                            completed: finalStatus === 'completed' ? new Date().toISOString() : null
                        }
                    });
                    console.log(`[API] Respuesta de Google Tasks: ${patchRes.status} ${patchRes.statusText}`);
                    
                    // Forzar actualización del icono
                    const settings = actions.get(context) || {};
                    updateTask(context, settings, true);
                } catch (e) {
                    console.error(`[API] Error al actualizar:`, e.response ? e.response.data : e.message);
                    exec(`zenity --error --title="Google Tasks" --text="Error al actualizar: ${e.message}"`);
                }
            } else {
                console.error(`[Auth] No se pudo obtener el cliente autenticado.`);
            }
        });
    }
});

// Polling cada 5 minutos
setInterval(() => {
    actions.forEach((settings, context) => {
        updateTask(context, settings);
    });
}, 5 * 60 * 1000);
