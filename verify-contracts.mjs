// verify-contracts.mjs — verificación de contratos entre módulos (solo local, no se sube)
const required = [
  'RESEARCHER_SYSTEM_PROMPT', 'ARCHITECT_SYSTEM_PROMPT', 'DESIGNER_SYSTEM_PROMPT',
  'FRONTEND_SYSTEM_PROMPT', 'BACKEND_SYSTEM_PROMPT_MONGO', 'DATABASE_SYSTEM_PROMPT',
  'INTEGRATION_SYSTEM_PROMPT', 'QA_SYSTEM_PROMPT', 'PATCHER_SYSTEM_PROMPT', 'REPAIR_SYSTEM_PROMPT',
];

const prompts = await import('./bridge-marisai-prompts.js');
const missing = required.filter((k) => !(k in prompts));
const shortOnes = required.filter((k) => k in prompts && (!prompts[k] || String(prompts[k]).trim().length < 50));
console.log('PROMPTS MISSING:', missing.length ? missing.join(',') : 'ninguno');
console.log('PROMPTS EMPTY/SHORT:', shortOnes.length ? shortOnes.join(',') : 'ninguno');
for (const k of required) {
  if (prompts[k]) console.log(`  ${k} -> ${String(prompts[k]).length} chars`);
}

const bridge = await import('./bridge-marisai.js');
const bridgeRequired = ['runDeterministicAgent', 'resolveTemplatePrompt', 'registerBridgeAdminRoutes'];
const bridgeMissing = bridgeRequired.filter((k) => typeof bridge[k] !== 'function');
console.log('BRIDGE MISSING:', bridgeMissing.length ? bridgeMissing.join(',') : 'ninguno');

const seed = await import('./seed-owner-agents.js');
console.log('SEED exports seedOwnerAgentsIfEmpty:', typeof seed.seedOwnerAgentsIfEmpty === 'function' ? 'OK' : 'FALTA');

if (missing.length || shortOnes.length || bridgeMissing.length || typeof seed.seedOwnerAgentsIfEmpty !== 'function') {
  console.error('❌ CONTRATOS ROTOS');
  process.exit(1);
}
console.log('✅ TODOS LOS CONTRATOS OK');
