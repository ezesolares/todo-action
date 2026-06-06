const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const opener = require('opener');

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

async function authenticate() {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        const errorText = '--- ERROR: credentials.json NO ENCONTRADO ---\nPara obtenerlo:\n1. Ve a https://console.cloud.google.com/\n2. Crea un proyecto y habilita la API de Google Tasks.\n3. Ve a "APIs & Services" > "Credentials".\n4. Haz clic en "Create Credentials" > "OAuth client ID".\n5. Selecciona "Desktop App" y dale un nombre.\n6. Descarga el JSON y guárdalo como "credentials.json" en esta carpeta.';
        logToFile('ERROR', errorText);
        return;
    }

    const content = fs.readFileSync(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    
    // Forzamos localhost:3000 para el helper para que sea predecible
    const redirectUri = 'http://localhost:3000';
    const oauth2Client = new OAuth2Client(
        key.client_id,
        key.client_secret,
        redirectUri
    );

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent' // Forzar consentimiento para asegurar el refresh token
    });

    logToFile('INFO', `--- PASO 1: Copia esta URL en tu navegador o espera a que se abra automáticamente ---\n${authUrl}\n--------------------------------------------`);
    
    // Intentar abrir automáticamente, pero si falla el enlace está arriba
    opener(authUrl);

    logToFile('INFO', `--- PASO 2: Escuchando en ${redirectUri} para recibir el código... ---`);

    const server = http.createServer(async (req, res) => {
        const fullUrl = `http://localhost:3000${req.url}`;
        logToFile('INFO', `Petición recibida en el servidor: ${fullUrl}`);
        
        try {
            const urlParsed = new URL(fullUrl);
            const code = urlParsed.searchParams.get('code');

            if (code) {
                logToFile('INFO', 'Código de autorización detectado. Canjeando por tokens...');
                
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Autenticacion exitosa!</h1><p>Ya puedes volver a la terminal.</p>');
                
                const { tokens } = await oauth2Client.getToken(code);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                
                logToFile('INFO', '--- EXITO: Token guardado en token.json ---');
                server.close(() => {
                    logToFile('INFO', 'Servidor de autenticación cerrado.');
                    process.exit(0);
                });
            } else {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Esperando el codigo de Google (no se detecto "code" en la URL)...');
            }
        } catch (e) {
            logToFile('ERROR', 'Error procesando el callback de OAuth:', e);
            res.writeHead(500);
            res.end('Error interno.');
        }
    }).listen(3000, () => {
        logToFile('INFO', 'Servidor local iniciado en puerto 3000.');
    });
}

authenticate();
