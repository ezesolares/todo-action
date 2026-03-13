const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const opener = require('opener');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/tasks'];

async function authenticate() {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.error('--- ERROR: credentials.json NO ENCONTRADO ---');
        console.error('Para obtenerlo:');
        console.error('1. Ve a https://console.cloud.google.com/');
        console.error('2. Crea un proyecto y habilita la API de Google Tasks.');
        console.error('3. Ve a "APIs & Services" > "Credentials".');
        console.error('4. Haz clic en "Create Credentials" > "OAuth client ID".');
        console.error('5. Selecciona "Desktop App" y dale un nombre.');
        console.error('6. Descarga el JSON y guárdalo como "credentials.json" en esta carpeta.');
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

    console.log('--- PASO 1: Copia esta URL en tu navegador ---');
    console.log(authUrl);
    console.log('--------------------------------------------');
    
    // Intentar abrir automáticamente, pero si falla el enlace está arriba
    opener(authUrl);

    console.log(`--- PASO 2: Escuchando en ${redirectUri} para recibir el código... ---`);

    const server = http.createServer(async (req, res) => {
        const fullUrl = `http://localhost:3000${req.url}`;
        console.log(`Petición recibida en el servidor: ${fullUrl}`);
        
        try {
            const urlParsed = new URL(fullUrl);
            const code = urlParsed.searchParams.get('code');

            if (code) {
                console.log('Código detectado. Canjeando por tokens...');
                
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>Autenticacion exitosa!</h1><p>Ya puedes volver a la terminal.</p>');
                
                const { tokens } = await oauth2Client.getToken(code);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                
                console.log('--- EXITO: Token guardado en token.json ---');
                server.close(() => {
                    console.log('Servidor de autenticación cerrado.');
                    process.exit(0);
                });
            } else {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Esperando el codigo de Google (no se detecto "code" en la URL)...');
            }
        } catch (e) {
            console.error('Error procesando el callback:', e);
            res.writeHead(500);
            res.end('Error interno.');
        }
    }).listen(3000, () => {
        console.log('Servidor local iniciado en puerto 3000.');
    });
}

authenticate();
