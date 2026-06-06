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
const LOG_PATH = path.join(__dirname, 'plugin.log');
const SCOPES = ['https://www.googleapis.com/auth/tasks'];

// --- Sistema de Logs ---
function logToFile(level, message, error = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] [${level}] ${message}`;
    if (error) {
        logMsg += `\nError details: ${error.stack || error.message || error}`;
    }
    logMsg += '\n';
    try {
        fs.appendFileSync(LOG_PATH, logMsg);
    } catch (e) {
        console.error('Failed to write to log file:', e);
    }
    // Also log to console
    if (level === 'ERROR') {
        console.error(message, error || '');
    } else if (level === 'WARN') {
        console.warn(message, error || '');
    } else {
        console.log(message, error || '');
    }
}

// --- Argumentos de Stream Deck ---
const args = process.argv;
const port = args[args.findIndex(a => a === '-port') + 1];
const uuid = args[args.findIndex(a => a === '-pluginUUID') + 1];
const registerEvent = args[args.findIndex(a => a === '-registerEvent') + 1];

let ws = new WebSocket(`ws://127.0.0.1:${port}`);
ws.on('error', (err) => {
    logToFile('ERROR', `WebSocket error: ${err.message}`, err);
});
let actions = new Map(); // Mapa para seguir las instancias de acciones y sus configuraciones
let currentTasksData = new Map(); // Mapa para guardar los datos de la tarea actual por context
let isAuthenticating = false;
let cachedAuthClient = null; // Cache del cliente de Google Auth

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Cola de Ejecución Secuencial para evitar SEGV de Canvas ---
let actionQueue = Promise.resolve();
function enqueueAction(actionFn) {
    actionQueue = actionQueue.then(async () => {
        try {
            await actionFn();
            await sleep(50);
        } catch (e) {
            logToFile('ERROR', 'Error in enqueued action:', e);
        }
    });
}

// --- Automatización de Re-autenticación ---
function triggerAutoAuth() {
    if (isAuthenticating) return;
    isAuthenticating = true;

    logToFile('WARN', '[Auth] Detectado token inválido. Iniciando recuperación automática...');

    // Notificar al usuario proactivamente
    const zenityCmd = `zenity --info --title="Google Tasks" --text="Tu sesión de Google ha expirado.\n\nSe abrirá el navegador automáticamente para que vuelvas a iniciar sesión y restaurar la conexión." --timeout=30`;
    
    exec(zenityCmd, () => {
        logToFile('INFO', '[Auth] Lanzando auth-helper.js...');
        
        // Ejecutar el script de ayuda
        exec('node auth-helper.js', async (error, stdout, stderr) => {
            isAuthenticating = false;
            if (error) {
                logToFile('ERROR', `[Auth] Error en auto-auth. Code: ${error.code}. Stderr: ${stderr}. Stdout: ${stdout}`, error);
                return;
            }
            logToFile('INFO', `[Auth] Re-autenticación completada. Stdout: ${stdout}`);
            
            // Refrescar todos los botones activos de forma SECUENCIAL para evitar SEGV en Node 22
            for (const [context, settings] of actions.entries()) {
                enqueueAction(() => updateTask(context, settings, true));
            }
        });
    });
}

// --- Lógica de Autenticación de Google ---
async function getAuthenticatedClient() {
    if (cachedAuthClient) return { client: cachedAuthClient };

    if (!fs.existsSync(CREDENTIALS_PATH)) {
        return { client: null, error: 'CREDENTIALS_MISSING' };
    }

    let key;
    try {
        const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
        if (!content.trim()) {
            return { client: null, error: 'CREDENTIALS_EMPTY' };
        }
        const keys = JSON.parse(content);
        key = keys.installed || keys.web;
        if (!key || !key.client_id || !key.client_secret) {
            return { client: null, error: 'CREDENTIALS_INVALID' };
        }
    } catch (err) {
        return { client: null, error: 'CREDENTIALS_PARSE_ERROR', details: err };
    }

    const auth = new OAuth2Client(key.client_id, key.client_secret, key.redirect_uris[0]);

    if (fs.existsSync(TOKEN_PATH)) {
        try {
            const tokenContent = fs.readFileSync(TOKEN_PATH, 'utf8');
            if (!tokenContent.trim()) {
                return { client: null, error: 'TOKEN_EMPTY' };
            }
            const token = JSON.parse(tokenContent);
            auth.setCredentials(token);

            // Listener para guardar el token si Google lo refresca automáticamente
            auth.on('tokens', (tokens) => {
                logToFile('INFO', '[Auth] Token refrescado automáticamente, guardando...');
                try {
                    let currentToken = {};
                    if (fs.existsSync(TOKEN_PATH)) {
                        const existingContent = fs.readFileSync(TOKEN_PATH, 'utf8');
                        if (existingContent.trim()) {
                            currentToken = JSON.parse(existingContent);
                        }
                    }
                    const updatedToken = { ...currentToken, ...tokens };
                    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedToken));
                } catch (err) {
                    logToFile('ERROR', '[Auth] Error al guardar el token refrescado automáticamente', err);
                }
            });

            cachedAuthClient = auth;
            return { client: auth };
        } catch (err) {
            return { client: null, error: 'TOKEN_PARSE_ERROR', details: err };
        }
    }

    return { client: null, error: 'TOKEN_MISSING' };
}

// --- Lógica de Renderizado Canvas ---
function drawTaskImage(text, settings, isError = false) {
    const { fontFamily = 'Verdana', fontSize = 12, maxCharsPerLine = 10 } = settings;
    const canvas = createCanvas(72, 72);
    const ctx = canvas.getContext('2d');

    // Fondo negro, o rojo oscuro si es un error
    ctx.fillStyle = isError ? '#3d0a0a' : '#000000';
    ctx.fillRect(0, 0, 72, 72);

    // Configuración de texto: blanco, o rojo brillante si es un error
    ctx.fillStyle = isError ? '#ff5555' : '#FFFFFF';
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
    const authResult = await getAuthenticatedClient();
    if (!authResult.client) {
        let errorMsg = 'Error Auth';
        if (authResult.error === 'CREDENTIALS_MISSING') {
            errorMsg = 'Falta credentials.json';
        } else if (authResult.error === 'CREDENTIALS_EMPTY') {
            errorMsg = 'credentials.json vacio';
        } else if (authResult.error === 'CREDENTIALS_INVALID' || authResult.error === 'CREDENTIALS_PARSE_ERROR') {
            errorMsg = 'Error credentials.json';
        } else if (authResult.error === 'TOKEN_MISSING') {
            errorMsg = 'Falta token.json';
        } else if (authResult.error === 'TOKEN_EMPTY') {
            errorMsg = 'token.json vacio';
        } else if (authResult.error === 'TOKEN_PARSE_ERROR') {
            errorMsg = 'Error token.json';
        }

        logToFile('WARN', `[updateTask] Error de autenticación: ${errorMsg}`, authResult.details);

        const base64Image = drawTaskImage(errorMsg, settings, true);
        ws.send(JSON.stringify({
            event: 'setImage',
            context: context,
            payload: { image: `data:image/png;base64,${base64Image}`, target: 0 }
        }));
        return;
    }

    const auth = authResult.client;
    const tasksClient = tasks({ version: 'v1', auth });
    const taskIndex = parseInt(settings.taskIndex || 1) - 1;
    const listId = settings.listId || null;
    const onlyOpenTasks = settings.onlyOpenTasks === undefined ? true : (settings.onlyOpenTasks === 'true' || settings.onlyOpenTasks === true);

    try {
        let selectedListId = listId;

        // Si no hay lista seleccionada, buscamos la primera lista disponible
        if (!selectedListId) {
            const res = await tasksClient.tasklists.list({ maxResults: 1 });
            if (!res.data.items || res.data.items.length === 0) {
                const base64Image = drawTaskImage('Sin listas', settings);
                ws.send(JSON.stringify({
                    event: 'setImage',
                    context: context,
                    payload: { image: `data:image/png;base64,${base64Image}`, target: 0 }
                }));
                return;
            }
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

        const task = taskItems[taskIndex] || { id: 'none', title: 'Sin tareas' };
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
        
        // Guardar datos para el editor
        if (task.id !== 'none') {
            currentTasksData.set(context, {
                id: task.id,
                title: taskTitle,
                listId: selectedListId
            });
        }

        if (!force && lastRenderedData.get(context) === cacheKey) {
            // No hay cambios, no renderizamos
            return;
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
        logToFile('ERROR', 'Error al obtener tareas:', err);
        let errorMsg = 'Error API';
        if (err.message && err.message.includes('invalid_grant')) {
            cachedAuthClient = null;
            triggerAutoAuth();
            errorMsg = 'Reauth';
        } else if (err.message && (err.message.includes('ENOTFOUND') || err.message.includes('EAI_AGAIN') || err.message.includes('fetch failed'))) {
            errorMsg = 'Sin red';
        } else if (err.status === 403) {
            errorMsg = 'Sin permiso';
        } else if (err.status === 404) {
            errorMsg = 'No lista';
        }

        const base64Image = drawTaskImage(errorMsg, settings, true);
        ws.send(JSON.stringify({
            event: 'setImage',
            context: context,
            payload: { image: `data:image/png;base64,${base64Image}`, target: 0 }
        }));
    }
}

async function fetchAndSendLists(context) {
    const authResult = await getAuthenticatedClient();
    if (!authResult.client) {
        let errorMsg = 'No se pudo autenticar.';
        if (authResult.error === 'CREDENTIALS_MISSING') {
            errorMsg = 'Falta credentials.json';
        } else if (authResult.error === 'TOKEN_MISSING') {
            errorMsg = 'Falta token.json';
        } else if (authResult.error === 'TOKEN_EMPTY' || authResult.error === 'TOKEN_PARSE_ERROR') {
            errorMsg = 'token.json corrupto o vacio';
        } else if (authResult.error === 'CREDENTIALS_INVALID' || authResult.error === 'CREDENTIALS_PARSE_ERROR') {
            errorMsg = 'credentials.json corrupto o vacio';
        }
        
        ws.send(JSON.stringify({
            event: 'sendToPropertyInspector',
            context: context,
            payload: { error: errorMsg }
        }));
        logToFile('WARN', `[fetchAndSendLists] ${errorMsg}`, authResult.details);
        return;
    }

    const auth = authResult.client;
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
        logToFile('ERROR', 'Error al obtener listas:', err);
        let errorMsg = 'Error al obtener listas: ' + err.message;
        
        if (err.message && err.message.includes('invalid_grant')) {
            cachedAuthClient = null;
            errorMsg = 'Error: Sesión expirada. Iniciando recuperación automática...';
            triggerAutoAuth();
        }

        ws.send(JSON.stringify({
            event: 'sendToPropertyInspector',
            context: context,
            payload: { error: errorMsg }
        }));
    }
}

// --- WebSocket Handlers ---
ws.on('open', () => {
    ws.send(JSON.stringify({
        event: registerEvent,
        uuid: uuid
    }));
});

ws.on('message', async (data) => {
    const json = JSON.parse(data);
    const { event, context, payload } = json;

    if (event === 'willAppear') {
        const settings = payload.settings || {};
        actions.set(context, settings);
        enqueueAction(() => updateTask(context, settings, true)); // Forzar renderizado inicial
    }

    if (event === 'didReceiveSettings') {
        const settings = payload.settings;
        actions.set(context, settings);
        enqueueAction(() => updateTask(context, settings, true)); // Forzar cuando se cambian ajustes
    }

    if (event === 'propertyInspectorDidAppear') {
        enqueueAction(() => fetchAndSendLists(context));
    }

    if (event === 'sendToPlugin' && payload && payload.action === 'refreshLists') {
        enqueueAction(() => fetchAndSendLists(context));
    }

    if (event === 'keyDown') {
        const settings = actions.get(context) || {};
        let taskData = currentTasksData.get(context);

        // Si no hay datos, intentamos un refresco inmediato antes de fallar
        if (!taskData) {
            logToFile('INFO', `[keyDown] Datos no encontrados para ${context}, intentando updateTask...`);
            await new Promise(resolve => {
                enqueueAction(async () => {
                    await updateTask(context, settings, true);
                    resolve();
                });
            });
            taskData = currentTasksData.get(context);
        }

        if (!taskData) {
            exec(`zenity --error --title="Google Tasks" --text="No hay datos de la tarea para este botón. Reintenta ahora o espera a que se refresque."`);
            return;
        }

        // Dialogo único con Zenity
        const sanitizedTitle = taskData.title.replace(/"/g, '\\"');
        const cmd = `zenity --entry --title="Gestionar Tarea" --text="Modifica el título o marca como completada:" --entry-text="${sanitizedTitle}" --ok-label="Actualizar Texto" --extra-button="Completada" --cancel-label="Cancelar"`;

        exec(cmd, async (err, stdout) => {
            const result = stdout.trim();
            logToFile('INFO', `[Zenity] Salida del diálogo: "${result}"`);

            if (err && !result) {
                logToFile('INFO', `[Zenity] Diálogo cancelado o error real: ${err.message}`);
                return;
            }
            
            let newTitle = taskData.title;
            let finalStatus = 'needsAction';

            if (result === 'Completada') {
                finalStatus = 'completed';
                logToFile('INFO', `[Update] Marcando tarea como COMPLETADA: ${taskData.id}`);
            } else if (result) {
                newTitle = result;
                logToFile('INFO', `[Update] Actualizando título a: "${newTitle}" para la tarea: ${taskData.id}`);
            } else {
                return; // Caso borde
            }
            
            const authResult = await getAuthenticatedClient();
            if (authResult.client) {
                try {
                    const tasksClient = tasks({ version: 'v1', auth: authResult.client });
                    logToFile('INFO', `[API] Llamando a tasks.patch para tasklist: ${taskData.listId}, task: ${taskData.id}`);
                    const patchRes = await tasksClient.tasks.patch({
                        tasklist: taskData.listId,
                        task: taskData.id,
                        requestBody: {
                            title: newTitle,
                            status: finalStatus,
                            completed: finalStatus === 'completed' ? new Date().toISOString() : null
                        }
                    });
                    logToFile('INFO', `[API] Respuesta de Google Tasks: ${patchRes.status} ${patchRes.statusText}`);
                    
                    // Forzar actualización del icono
                    const settings = actions.get(context) || {};
                    enqueueAction(() => updateTask(context, settings, true));
                } catch (e) {
                    let errorMsg = e.message;
                    if (e.message && e.message.includes('invalid_grant')) {
                        cachedAuthClient = null;
                        errorMsg = 'Error: Sesión expirada. Re-autentica en el navegador.';
                        triggerAutoAuth();
                    }
                    logToFile('ERROR', `[API] Error al actualizar:`, e.response ? e.response.data : e.message);
                    exec(`zenity --error --title="Google Tasks" --text="Error al actualizar: ${errorMsg}"`);
                }
            } else {
                logToFile('ERROR', `[Auth] No se pudo obtener el cliente autenticado.`);
            }
        });
    }
});

// Polling cada 1 minuto - Procesado secuencial para estabilidad
setInterval(() => {
    for (const [context, settings] of actions.entries()) {
        enqueueAction(() => updateTask(context, settings));
    }
}, 1 * 60 * 1000);
