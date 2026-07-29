import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Textarea, Badge, CopyButton, Spinner, toast } from './ui';
import { useApi } from '../hooks/useApi';

interface Skill {
  id: string;
  name: string;
  data: {
    descripcion?: string;
    schema?: object;
    tipo?: string;
  };
  createdAt: string;
}

const SKILL_TEMPLATE = JSON.stringify({
  name: 'mi_herramienta',
  description: 'Descripción de lo que hace esta herramienta',
  parameters: {
    type: 'object',
    properties: {
      parametro1: { type: 'string', description: 'Descripción del parámetro' },
    },
    required: ['parametro1'],
  },
}, null, 2);

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SkillsPanel({ open, onClose }: Props) {
  const { get, post, put, del } = useApi();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);

  // Form state
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillSchema, setSkillSchema] = useState(SKILL_TEMPLATE);
  const [schemaError, setSchemaError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await get<Skill[]>('/api/resources?type=habilidad');
      setSkills(data);
    } catch (e: any) {
      toast('error', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); }, [open]);

  const validateSchema = (text: string): boolean => {
    try {
      JSON.parse(text);
      setSchemaError('');
      return true;
    } catch (e: any) {
      setSchemaError(`JSON inválido: ${e.message}`);
      return false;
    }
  };

  const openCreate = () => {
    setEditing(null);
    setSkillName('');
    setSkillDesc('');
    setSkillSchema(SKILL_TEMPLATE);
    setSchemaError('');
    setCreating(true);
  };

  const openEdit = (skill: Skill) => {
    setEditing(skill);
    setSkillName(skill.name);
    setSkillDesc(skill.data.descripcion || '');
    setSkillSchema(skill.data.schema ? JSON.stringify(skill.data.schema, null, 2) : SKILL_TEMPLATE);
    setSchemaError('');
    setCreating(true);
  };

  const handleSave = async () => {
    if (!skillName.trim()) { toast('error', 'El nombre es obligatorio'); return; }
    if (!validateSchema(skillSchema)) return;
    setSaving(true);
    try {
      const schema = JSON.parse(skillSchema);
      const data = { descripcion: skillDesc.trim(), schema, tipo: 'tool' };
      if (editing) {
        await put(`/api/resources/${editing.id}`, { name: skillName.trim(), data });
        toast('success', 'Habilidad actualizada');
      } else {
        await post('/api/resources', { type: 'habilidad', name: skillName.trim(), data });
        toast('success', 'Habilidad creada');
      }
      setCreating(false);
      load();
    } catch (e: any) {
      toast('error', e.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (skill: Skill) => {
    if (!confirm(`¿Eliminar "${skill.name}"? Los agentes que la usaban perderán acceso.`)) return;
    try {
      await del(`/api/resources/${skill.id}`);
      toast('success', 'Habilidad eliminada');
      load();
    } catch (e: any) {
      toast('error', e.message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Toolbox — Habilidades" subtitle="Herramientas personalizadas en formato JSON Schema compatible con Ollama" size="xl">
      {creating ? (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Nombre de la habilidad</label>
              <Input value={skillName} onChange={e => setSkillName(e.target.value)} placeholder="mi_herramienta_custom" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Descripción breve</label>
              <Input value={skillDesc} onChange={e => setSkillDesc(e.target.value)} placeholder="Para qué sirve esta herramienta" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-500">JSON Schema (formato OpenAI / Ollama)</label>
              <CopyButton text={skillSchema} label="Copiar" />
            </div>
            <Textarea value={skillSchema}
              onChange={e => { setSkillSchema(e.target.value); validateSchema(e.target.value); }}
              rows={14}
              className="font-mono text-[11px]"
              spellCheck={false}
            />
            {schemaError && <p className="text-xs text-red-400 mt-1.5">⚠ {schemaError}</p>}
          </div>
          <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-[#222]">
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} disabled={!!schemaError}>
              {editing ? 'Guardar cambios' : 'Crear habilidad'}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={openCreate} size="sm">+ Nueva habilidad</Button>
          </div>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner size={24} /></div>
          ) : skills.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">⚡</div>
              <p className="text-gray-500 text-sm mb-4">Sin habilidades todavía</p>
              <Button onClick={openCreate} size="sm">Crear la primera</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {skills.map(skill => (
                <div key={skill.id} className="flex items-center justify-between p-4 bg-[#111] border border-[#222] rounded-xl hover:border-[#333] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-purple-900/40 border border-purple-700/30 rounded-lg flex items-center justify-center text-sm shrink-0">⚡</div>
                    <div className="min-w-0">
                      <p className="font-medium text-white text-sm truncate">{skill.name}</p>
                      <p className="text-[11px] text-gray-500 truncate">{skill.data.descripcion || 'Sin descripción'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    {skill.data.schema && <Badge variant="purple">JSON Schema</Badge>}
                    <Button variant="ghost" size="sm" onClick={() => openEdit(skill)}>✎ Editar</Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(skill)}>🗑</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
