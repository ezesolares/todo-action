#!/usr/bin/env bash
set -e

PLUGIN_DIR="me.innovatewith.googletasks.sdPlugin"

echo "=== Iniciando construcción del plugin ==="

# Limpiar carpeta anterior
if [ -d "$PLUGIN_DIR" ]; then
    echo "Limpiando directorio existente..."
    rm -rf "$PLUGIN_DIR"
fi

# Crear estructura
echo "Creando estructura..."
mkdir -p "$PLUGIN_DIR"

# Copiar archivos base
echo "Copiando archivos de código..."
cp manifest.json index.js auth-helper.js package.json package-lock.json "$PLUGIN_DIR/"

# Copiar recursos
echo "Copiando iconos y panel de configuración..."
cp -r icons/ "$PLUGIN_DIR/"
cp -r pi/ "$PLUGIN_DIR/"

# Copiar credenciales si existen (útil para desarrollo local)
if [ -f credentials.json ]; then
    echo "Incluyendo credentials.json..."
    cp credentials.json "$PLUGIN_DIR/"
fi

if [ -f token.json ]; then
    echo "Incluyendo token.json..."
    cp token.json "$PLUGIN_DIR/"
fi

# Instalar dependencias (solo producción)
echo "Instalando dependencias de Node.js..."
cd "$PLUGIN_DIR"
npm install --production

echo "=== Construcción finalizada con éxito en $PLUGIN_DIR/ ==="
