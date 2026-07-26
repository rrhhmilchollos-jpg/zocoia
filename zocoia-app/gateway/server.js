const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const validPrefixes = ['sk-marisai-', 'sk-zoco-'];

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "No API key provided" });
    }
    const token = authHeader.split(' ')[1];
    const hasValidPrefix = validPrefixes.some(prefix => token.startsWith(prefix));
    if (!hasValidPrefix) {
        return res.status(401).json({ error: "Invalid API key format" });
    }
    next();
};

app.post('/v1/chat/completions', authMiddleware, (req, res) => {
    res.json({ choices: [{ message: { role: "assistant", content: "Respuesta Zoco OpenAI" } }] });
});

app.post('/v1/messages', authMiddleware, (req, res) => {
    res.json({
        id: "msg_" + crypto.randomBytes(12).toString('hex'),
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Zoco IA (Adaptador Anthropic Activo): Planificación completada." }],
        model: req.body.model || "maris-core-7b",
        stop_reason: "end_turn"
    });
});

app.listen(5001, () => {
    console.log('Zoco IA Gateway activo en puerto 5001.');
});
