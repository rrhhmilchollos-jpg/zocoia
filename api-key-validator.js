/**
 * Módulo de Validación de API Keys
 * Valida API Keys en caliente antes de guardarlas en la base de datos
 */

import crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

/**
 * Encripta una API Key para almacenamiento seguro
 */
export function encryptApiKey(apiKey) {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
  } catch (err) {
    console.error('Error encrypting API key:', err);
    throw new Error('Error al encriptar la clave');
  }
}

/**
 * Desencripta una API Key almacenada
 */
export function decryptApiKey(encryptedKey) {
  try {
    const [ivHex, encryptedHex, authTagHex] = encryptedKey.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Error decrypting API key:', err);
    throw new Error('Error al desencriptar la clave');
  }
}

/**
 * Genera un prefijo y sufijo para mostrar la clave de forma segura
 * Ejemplo: sk-...xrFk
 */
export function maskApiKey(apiKey) {
  if (apiKey.length <= 8) return '***';
  const prefix = apiKey.substring(0, 3);
  const suffix = apiKey.substring(apiKey.length - 4);
  return `${prefix}...${suffix}`;
}

/**
 * Valida una API Key de OpenAI
 */
export async function validateOpenAIKey(apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return { valid: true, provider: 'openai' };
    } else if (response.status === 401) {
      return { valid: false, error: 'API Key de OpenAI inválida o expirada' };
    } else {
      return { valid: false, error: `Error de OpenAI: ${response.status}` };
    }
  } catch (err) {
    return { valid: false, error: `Error al validar OpenAI: ${err.message}` };
  }
}

/**
 * Valida una API Key de Anthropic
 */
export async function validateAnthropicKey(apiKey) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-opus-20240229',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok || response.status === 400) {
      // 400 es OK para validación (significa que la key es válida pero el request es incompleto)
      return { valid: true, provider: 'anthropic' };
    } else if (response.status === 401) {
      return { valid: false, error: 'API Key de Anthropic inválida o expirada' };
    } else {
      return { valid: false, error: `Error de Anthropic: ${response.status}` };
    }
  } catch (err) {
    return { valid: false, error: `Error al validar Anthropic: ${err.message}` };
  }
}

/**
 * Valida una API Key de Groq
 */
export async function validateGroqKey(apiKey) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return { valid: true, provider: 'groq' };
    } else if (response.status === 401) {
      return { valid: false, error: 'API Key de Groq inválida o expirada' };
    } else {
      return { valid: false, error: `Error de Groq: ${response.status}` };
    }
  } catch (err) {
    return { valid: false, error: `Error al validar Groq: ${err.message}` };
  }
}

/**
 * Valida una API Key según su proveedor
 */
export async function validateApiKey(apiKey, provider) {
  if (!apiKey || !provider) {
    return { valid: false, error: 'API Key y proveedor son requeridos' };
  }

  switch (provider.toLowerCase()) {
    case 'openai':
      return await validateOpenAIKey(apiKey);
    case 'anthropic':
      return await validateAnthropicKey(apiKey);
    case 'groq':
      return await validateGroqKey(apiKey);
    case 'custom':
      // Para custom APIs, solo validamos que no esté vacía
      return { valid: apiKey.length > 0, provider: 'custom' };
    default:
      return { valid: false, error: `Proveedor desconocido: ${provider}` };
  }
}
