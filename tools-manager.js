/**
 * Módulo de Gestión de Herramientas (Tools)
 * Valida y gestiona herramientas en formato JSON Schema
 */

/**
 * Valida que un objeto sea un JSON Schema válido
 */
export function validateJsonSchema(schema) {
  try {
    if (typeof schema === 'string') {
      schema = JSON.parse(schema);
    }

    // Validaciones básicas de JSON Schema
    if (!schema || typeof schema !== 'object') {
      return { valid: false, error: 'El schema debe ser un objeto JSON válido' };
    }

    // Validar que tenga al menos un tipo o propiedades
    if (!schema.type && !schema.properties && !schema.$ref) {
      return { valid: false, error: 'El schema debe tener al menos "type", "properties" o "$ref"' };
    }

    // Si tiene propiedades, validar que sea un objeto
    if (schema.properties && typeof schema.properties !== 'object') {
      return { valid: false, error: 'Las propiedades del schema deben ser un objeto' };
    }

    // Validar tipos válidos de JSON Schema
    const validTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'];
    if (schema.type && !validTypes.includes(schema.type)) {
      return { valid: false, error: `Tipo inválido: ${schema.type}. Tipos válidos: ${validTypes.join(', ')}` };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Error al validar schema: ${err.message}` };
  }
}

/**
 * Normaliza un JSON Schema para almacenamiento
 */
export function normalizeJsonSchema(schema) {
  try {
    if (typeof schema === 'string') {
      schema = JSON.parse(schema);
    }
    return JSON.stringify(schema);
  } catch (err) {
    throw new Error(`Error al normalizar schema: ${err.message}`);
  }
}

/**
 * Valida que una herramienta tenga los campos requeridos
 */
export function validateToolData(name, description, jsonSchema) {
  const errors = [];

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('El nombre de la herramienta es requerido');
  }

  if (name && name.length > 255) {
    errors.push('El nombre no puede exceder 255 caracteres');
  }

  if (description && description.length > 1000) {
    errors.push('La descripción no puede exceder 1000 caracteres');
  }

  const schemaValidation = validateJsonSchema(jsonSchema);
  if (!schemaValidation.valid) {
    errors.push(schemaValidation.error);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Crea una herramienta normalizada para almacenamiento
 */
export function createToolData(name, description, jsonSchema) {
  const validation = validateToolData(name, description, jsonSchema);
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '));
  }

  return {
    description: description || '',
    jsonSchema: normalizeJsonSchema(jsonSchema),
  };
}

/**
 * Valida que un agente tenga herramientas válidas asignadas
 */
export function validateAgentTools(toolIds, availableTools) {
  if (!Array.isArray(toolIds)) {
    return { valid: false, error: 'Las herramientas deben ser un array' };
  }

  const availableIds = new Set(availableTools.map(t => t.id));
  const invalidIds = toolIds.filter(id => !availableIds.has(id));

  if (invalidIds.length > 0) {
    return { valid: false, error: `Herramientas no válidas: ${invalidIds.join(', ')}` };
  }

  return { valid: true };
}

/**
 * Obtiene las herramientas asignadas a un agente
 */
export function getAgentTools(agentData, availableTools) {
  if (!agentData) return [];

  const toolIds = agentData.herramientasAsociadas || [];
  if (!Array.isArray(toolIds)) return [];

  return availableTools.filter(t => toolIds.includes(t.id));
}

/**
 * Actualiza las herramientas asignadas a un agente
 */
export function updateAgentTools(agentData, toolIds) {
  const updated = { ...agentData };
  updated.herramientasAsociadas = Array.isArray(toolIds) ? toolIds : [];
  return updated;
}
