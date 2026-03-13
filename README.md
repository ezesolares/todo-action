# OpenDeck Google Tasks Plugin

Este plugin permite visualizar y gestionar tareas de Google Tasks directamente desde un dispositivo compatible con OpenDeck o Stream Deck en sistemas Linux (Fedora/KDE).

## Características

- Visualización de tareas individuales en los iconos del dispositivo.
- Configuración personalizada: fuente (Verdana por defecto), tamaño de texto y ajuste de caracteres por línea.
- Selección de listas específicas de Google Tasks.
- Filtro opcional para mostrar solamente tareas pendientes.
- Integración nativa con KDE mediante `kdialog` para editar títulos o marcar tareas como completadas al pulsar el botón físico.
- Actualización automática mediante polling cada 5 minutos.

## Requisitos

- **Node.js**: Versión 16 o superior.
- **kdialog**: Necesario para las ventanas emergentes de interacción en KDE.
- **Credenciales de Google**: Un archivo `credentials.json` obtenido desde la Consola de Google Cloud con la API de Google Tasks habilitada.

## Instalación

1. Clonar el repositorio o descargar los archivos del plugin.
2. Crear un directorio para el plugin en la carpeta de configuración de OpenDeck:
   ```bash
   mkdir -p ~/.config/opendeck/plugins/me.innovatewith.googletasks.sdPlugin
   ```
3. Copiar el contenido del repositorio a dicha carpeta.
4. Instalar las dependencias de Node.js:
   ```bash
   cd ~/.config/opendeck/plugins/me.innovatewith.googletasks.sdPlugin
   npm install
   ```

## Configuración de Autenticación

Para que el plugin pueda acceder a tus tareas, debes generar un token de acceso:

1. Coloca tu archivo `credentials.json` en la raíz de la carpeta del plugin.
2. Ejecuta el asistente de autenticación:
   ```bash
   node auth-helper.js
   ```
3. Sigue el enlace que aparecerá en la terminal, autoriza la aplicación en tu cuenta de Google y el token se guardará automáticamente en `token.json`.

*Nota: El plugin requiere permisos de escritura (`https://www.googleapis.com/auth/tasks`) para permitir la edición y el marcado de tareas como completadas.*

## Uso

1. Inicia o reinicia OpenDeck.
2. Busca la acción "Tarea de Google" en el panel de acciones.
3. Arrastra la acción a un botón.
4. En el panel de propiedades, selecciona la lista de tareas y ajusta el índice de la tarea que deseas mostrar (#1, #2, etc.).
5. **Interacción**: Al pulsar el botón físico en el dispositivo, se abrirá un cuadro de diálogo de `kdialog` para editar el título. Posteriormente, se preguntará si se desea marcar la tarea como realizada.

## Estructura del Proyecto

- `index.js`: Lógica principal del plugin y servidor de WebSocket.
- `auth-helper.js`: Script para gestionar el flujo de OAuth2 y obtener el token.
- `manifest.json`: Definición de la acción y metadatos para OpenDeck.
- `pi/index.html`: Interfaz del Property Inspector (panel de configuración).
- `icons/`: Iconos de la aplicación y de la acción.
