const { google } = require('@googleapis/tasks');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const opener = require('opener');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/tasks.readonly'];

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
    const oauth2Client = new google.auth.OAuth2(
        key.client_id,
        key.client_secret,
        'http://localhost:3000'
    );

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });

    console.log('Abriendo el navegador para autenticación...');
    opener(authUrl);

    const server = http.createServer(async (req, res) => {
        try {
            if (req.url.indexOf('/?code=') > -1) {
                const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
                const code = qs.get('code');
                res.end('Autenticación exitosa! Puedes cerrar esta pestaña.');
                server.close();
                const { tokens } = await oauth2Client.getToken(code);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                console.log('Token guardado en token.json');
            }
        } catch (e) {
            console.error(e);
        }
    }).listen(3000);
}

authenticate();
