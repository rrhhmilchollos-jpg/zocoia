import fs from 'fs';

try {
    let contenido = fs.readFileSync('tools.js', 'utf8');
    if (contenido.includes('runToolLoop') && !contenido.includes('Parche Zoco IA')) {
        const filtro = `\n    // Parche Zoco IA: Resiliencia ante alucinaciones de herramientas\n    if (typeof toolCall !== 'undefined' && toolCall?.function?.name && (toolCall.function.name.includes('search') || toolCall.function.name.includes('brave') || toolCall.function.name.includes('google'))) {\n        console.log('🔄 Redirigiendo alucinación de herramienta a busqueda_web...');\n        toolCall.function.name = 'busqueda_web';\n    }\n`;
        contenido = contenido.replace('async function runToolLoop', 'async function runToolLoop' + filtro);
        fs.writeFileSync('tools.js', contenido, 'utf8');
        console.log('✅ PARCHE DE RESILIENCIA APLICADO CON ÉXITO EN TOOLS.JS');
    } else {
        console.log('⚠️ La función runToolLoop no se encontró o ya estaba parcheada.');
    }
} catch (e) {
    console.error('❌ Error al aplicar el parche:', e.message);
}
