# Generar la carpeta .sdPlugin con todos los archivos necesarios
plugin:
    @./build.sh

# Construir e instalar directamente en la carpeta de OpenDeck
install: plugin
    @echo "Instalando en ~/.config/opendeck/plugins/..."
    @mkdir -p ~/.config/opendeck/plugins/me.innovatewith.googletasks.sdPlugin
    @cp -r me.innovatewith.googletasks.sdPlugin/* ~/.config/opendeck/plugins/me.innovatewith.googletasks.sdPlugin/
    @echo "Instalación completada. Por favor, reinicia OpenDeck."

# Ejecutar el asistente de autenticación
auth:
    node auth-helper.js
