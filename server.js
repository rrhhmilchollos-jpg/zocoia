import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Ruta de salud para verificar que funciona
app.get('/health', (req, res) => {
    res.json({ status: "ok", message: "Zoco IA conectado con éxito" });
});

// Endpoint principal para simular o conectar con Ollama
app.post('/v1/chat/completions', (req, res) => {
    res.json({
        choices: [{
            message: {
                role: "assistant",
                content: "Conexión en vivo completada desde el nuevo servidor unificado de Zoco IA."
            }
        }]
    });
});

app.listen(port, () => {
    console.log(`🚀 Zoco IA Console corriendo en puerto ${port}`);
});
