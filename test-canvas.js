const { createCanvas } = require('canvas');
const fs = require('fs');

function drawTaskImage(text, settings) {
    const { fontFamily = 'Arial', fontSize = 12, maxCharsPerLine = 10 } = settings;
    const canvas = createCanvas(72, 72);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 72, 72);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `${fontSize}px "${fontFamily}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

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

    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    let startY = (72 - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, i) => {
        ctx.fillText(line, 36, startY + (i * lineHeight));
    });

    return canvas.toBuffer('image/png');
}

const testText = "Comprar pan y leche para el desayuno";
const settings = { fontFamily: 'Arial', fontSize: 12, maxCharsPerLine: 10 };
const buffer = drawTaskImage(testText, settings);

fs.writeFileSync('test-render.png', buffer);
console.log('Imagen de prueba generada: test-render.png');
