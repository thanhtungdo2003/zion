'use client';
import { useEffect, useMemo, useState } from 'react';
import { ITEMS, NPC_MODELS, STRUCTURE_KIND_IDS, objectiveText, validateContent, type GameContent, type NpcDef, type QuestDef, type QuestObjective } from '@zion/shared';
import { studioContent, studioSaveContent } from '@/lib/api';

type Tab = 'quests' | 'npcs' | 'life';

const S = {
  input: { background: '#10171b', color: '#eee', border: '1px solid #33444e', borderRadius: 4, padding: '4px 6px', width: '100%', boxSizing: 'border-box' } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#9fb3c0' } as React.CSSProperties,
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 8 } as React.CSSProperties,
  box: { border: '1px solid #2a3a44', borderRadius: 6, padding: 10, marginBottom: 10 } as React.CSSProperties,
};

const OBJECTIVE_TYPES: QuestObjective['type'][] = ['kill', 'visit', 'retrieve', 'deliver', 'plant', 'harvest', 'collect', 'cook', 'interact'];
const ITEM_IDS = Object.keys(ITEMS);

function blankObjective(type: QuestObjective['type']): QuestObjective {
  switch (type) {
    case 'kill': return { type, target: 'zombie', count: 5 };
    case 'visit': return { type, structure: 'house_small' };
    case 'retrieve': return { type, item: 'coal_carton', structure: 'factory', count: 1 };
    case 'deliver': return { type, item: 'potato', count: 1 };
    default: return { type, target: 'potato', count: 1 };
  }
}

function uniqueId(base: string, taken: Set<string>): string {
  let i = 1;
  let id = base;
  while (taken.has(id)) id = `${base}_${++i}`.slice(0, 40);
  return id;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={S.label}>{label}{children}</label>;
}

function Text({ value, onChange, area }: { value: string; onChange: (v: string) => void; area?: boolean }) {
  return area
    ? <textarea style={{ ...S.input, minHeight: 54, resize: 'vertical' }} value={value} onChange={(e) => onChange(e.target.value)} />
    : <input style={S.input} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Num({ value, onChange, step }: { value: number; onChange: (v: number) => void; step?: number }) {
  return <input style={S.input} type="number" step={step ?? 1} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return <select style={S.input} value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label style={{ ...S.label, flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

function ObjectiveEditor({ o, onChange, onRemove }: { o: QuestObjective; onChange: (o: QuestObjective) => void; onRemove: () => void }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...o, ...patch } as QuestObjective);
  return (
    <div style={{ ...S.row, alignItems: 'end', borderTop: '1px dashed #2a3a44', paddingTop: 8 }}>
      <Field label="Type"><Select value={o.type} options={OBJECTIVE_TYPES} onChange={(t) => onChange(blankObjective(t))} /></Field>
      {'target' in o && o.type !== 'kill' && <Field label="Target id (item / crop / object)"><Text value={o.target} onChange={(v) => set({ target: v })} /></Field>}
      {'item' in o && <Field label="Item"><Select value={o.item} options={ITEM_IDS} onChange={(v) => set({ item: v })} /></Field>}
      {'structure' in o && <Field label="Structure"><Select value={o.structure} options={STRUCTURE_KIND_IDS} onChange={(v) => set({ structure: v })} /></Field>}
      {'structure' in o && <Field label="Fixed location id (optional)"><Text value={o.location ?? ''} onChange={(v) => set({ location: v || undefined })} /></Field>}
      {'count' in o && <Field label="Count"><Num value={o.count} onChange={(v) => set({ count: v })} /></Field>}
      <div><button className="btn" onClick={onRemove}>Remove step</button></div>
      <small style={{ gridColumn: '1 / -1', color: '#7d8f9c' }}>{objectiveText(o)}</small>
    </div>
  );
}

function QuestForm({ q, npcs, questIds, onChange }: { q: QuestDef; npcs: string[]; questIds: string[]; onChange: (q: QuestDef) => void }) {
  const set = (patch: Partial<QuestDef>) => onChange({ ...q, ...patch });
  return (
    <div>
      <div style={S.row}>
        <Field label="Id"><Text value={q.id} onChange={(v) => set({ id: v })} /></Field>
        <Field label="NPC"><Select value={q.npc} options={npcs} onChange={(v) => set({ npc: v })} /></Field>
        <Field label="Kind"><Select value={q.kind} options={['daily', 'long'] as const} onChange={(v) => set({ kind: v })} /></Field>
        <Check label="Enabled" value={q.enabled} onChange={(v) => set({ enabled: v })} />
        <Check label="Can cancel" value={q.allowCancel !== false} onChange={(v) => set({ allowCancel: v })} />
      </div>
      <Field label="Title"><Text value={q.title} onChange={(v) => set({ title: v })} /></Field>
      <Field label="Description"><Text area value={q.description} onChange={(v) => set({ description: v })} /></Field>
      <Field label={`Prerequisites (quest ids, comma separated) — known: ${questIds.length}`}>
        <Text value={q.prereq.join(', ')} onChange={(v) => set({ prereq: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
      </Field>
      <div style={{ ...S.box, marginTop: 8 }}>
        <strong>Steps</strong>
        {q.objectives.map((o, i) => <ObjectiveEditor key={i} o={o} onChange={(n) => set({ objectives: q.objectives.map((x, j) => (j === i ? n : x)) })} onRemove={() => set({ objectives: q.objectives.filter((_, j) => j !== i) })} />)}
        <button className="btn" onClick={() => set({ objectives: [...q.objectives, blankObjective('kill')] })}>+ Add step</button>
      </div>
      <div style={S.box}>
        <strong>Rewards</strong>
        <div style={S.row}><Field label="ZCoin"><Num value={q.rewards.coins} onChange={(v) => set({ rewards: { ...q.rewards, coins: v } })} /></Field></div>
        {q.rewards.items.map((r, i) => (
          <div key={i} style={{ ...S.row, alignItems: 'end' }}>
            <Field label="Item"><Select value={r.item} options={ITEM_IDS} onChange={(v) => set({ rewards: { ...q.rewards, items: q.rewards.items.map((x, j) => (j === i ? { ...x, item: v } : x)) } })} /></Field>
            <Field label="Count"><Num value={r.count} onChange={(v) => set({ rewards: { ...q.rewards, items: q.rewards.items.map((x, j) => (j === i ? { ...x, count: v } : x)) } })} /></Field>
            <div><button className="btn" onClick={() => set({ rewards: { ...q.rewards, items: q.rewards.items.filter((_, j) => j !== i) } })}>Remove</button></div>
          </div>
        ))}
        <button className="btn" onClick={() => set({ rewards: { ...q.rewards, items: [...q.rewards.items, { item: 'potato', count: 1 }] } })}>+ Add item reward</button>
      </div>
      <div style={S.box}>
        <strong>Dialogue</strong>
        {(['offer', 'accept', 'progress', 'complete'] as const).map((k) => (
          <Field key={k} label={k}><Text value={q.dialogue[k]} onChange={(v) => set({ dialogue: { ...q.dialogue, [k]: v } })} /></Field>
        ))}
      </div>
    </div>
  );
}

function NpcForm({ n, onChange }: { n: NpcDef; onChange: (n: NpcDef) => void }) {
  const set = (patch: Partial<NpcDef>) => onChange({ ...n, ...patch });
  const linesField = (label: string, key: 'greetings' | 'ambient') => (
    <Field label={`${label} (one per line)`}><Text area value={n[key].join('\n')} onChange={(v) => set({ [key]: v.split('\n').map((s) => s.trim()).filter(Boolean) })} /></Field>
  );
  return (
    <div>
      <div style={S.row}>
        <Field label="Id"><Text value={n.id} onChange={(v) => set({ id: v })} /></Field>
        <Field label="Name"><Text value={n.name} onChange={(v) => set({ name: v })} /></Field>
        <Field label="Model"><Select value={n.model} options={NPC_MODELS} onChange={(v) => set({ model: v })} /></Field>
        <Field label="Weapon id (0 = none)"><Num value={n.weapon} onChange={(v) => set({ weapon: v })} /></Field>
        <Field label="X (camp-local m)"><Num step={0.5} value={n.x} onChange={(v) => set({ x: v })} /></Field>
        <Field label="Z (camp-local m)"><Num step={0.5} value={n.z} onChange={(v) => set({ z: v })} /></Field>
        <Field label="Interact range"><Num step={0.5} value={n.interactRange} onChange={(v) => set({ interactRange: v })} /></Field>
        <Field label="Greet range"><Num step={0.5} value={n.greetRange} onChange={(v) => set({ greetRange: v })} /></Field>
        <Field label="Line cooldown (ms)"><Num value={n.cooldownMs} onChange={(v) => set({ cooldownMs: v })} /></Field>
        <Field label="Bubble time (ms)"><Num value={n.bubbleMs} onChange={(v) => set({ bubbleMs: v })} /></Field>
        <Check label="Ambient lines public" value={n.ambientPublic} onChange={(v) => set({ ambientPublic: v })} />
      </div>
      {linesField('Greetings', 'greetings')}
      {linesField('Ambient lines', 'ambient')}
      <div style={S.box}>
        <Check label="Combat (shoots zombies near the gate)" value={!!n.combat?.enabled} onChange={(v) => set({ combat: { range: 30, fireIntervalMs: 2500, ...n.combat, enabled: v } })} />
        {n.combat?.enabled && <div style={S.row}>
          <Field label="Range (m)"><Num value={n.combat.range} onChange={(v) => set({ combat: { ...n.combat!, range: v } })} /></Field>
          <Field label="Fire interval (ms)"><Num value={n.combat.fireIntervalMs} onChange={(v) => set({ combat: { ...n.combat!, fireIntervalMs: v } })} /></Field>
        </div>}
      </div>
    </div>
  );
}

/** Camp Studio editor for quest NPCs, quests and base-life settings (validated before publishing). */
export function ContentEditor() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<GameContent | null>(null);
  const [tab, setTab] = useState<Tab>('quests');
  const [sel, setSel] = useState(0);
  const [filter, setFilter] = useState('');
  const [lifeDraft, setLifeDraft] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    studioContent().then((c) => { setContent(c); setLifeDraft(JSON.stringify(c.baseLife ?? null, null, 2)); setDirty(false); setMessage(''); }).catch((e: unknown) => setMessage(String(e)));
  }, [open]);

  const errors = useMemo(() => {
    if (!content) return [];
    const r = validateContent(content);
    return r.ok ? [] : r.errors;
  }, [content]);

  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Quests & NPCs</button>;

  const update = (next: GameContent) => { setContent(next); setDirty(true); };
  const list = content ? (tab === 'quests' ? content.quests : content.npcs) : [];
  const shown = list.map((x, i) => ({ x, i })).filter(({ x }) => !filter || JSON.stringify(x).toLowerCase().includes(filter.toLowerCase()));
  const current = list[sel];

  function add(duplicate: boolean) {
    if (!content) return;
    if (tab === 'quests') {
      const taken = new Set(content.quests.map((q) => q.id));
      const base: QuestDef = duplicate && content.quests[sel] ? structuredClone(content.quests[sel]) : {
        id: 'new_quest', npc: content.npcs[0]?.id ?? 'farmer', title: 'New quest', description: 'Describe the task.', kind: 'daily', enabled: false, prereq: [],
        objectives: [blankObjective('kill')], rewards: { coins: 50, items: [] }, dialogue: { offer: '…', accept: '…', progress: '…', complete: '…' },
      };
      base.id = uniqueId(duplicate ? `${base.id}_copy` : base.id, taken);
      update({ ...content, quests: [...content.quests, base] });
      setSel(content.quests.length);
    } else {
      const taken = new Set(content.npcs.map((n) => n.id));
      const base: NpcDef = duplicate && content.npcs[sel] ? structuredClone(content.npcs[sel]) : {
        id: 'new_npc', name: 'New NPC', model: NPC_MODELS[0], weapon: 0, x: 0, z: 0, interactRange: 3, greetRange: 8,
        greetings: ['Xin chào!'], ambient: [], ambientPublic: false, cooldownMs: 30_000, bubbleMs: 4000,
      };
      base.id = uniqueId(duplicate ? `${base.id}_copy` : base.id, taken);
      update({ ...content, npcs: [...content.npcs, base] });
      setSel(content.npcs.length);
    }
  }

  function remove() {
    if (!content || !current || !confirm(`Delete ${current.id}?`)) return;
    if (tab === 'quests') update({ ...content, quests: content.quests.filter((_, i) => i !== sel) });
    else update({ ...content, npcs: content.npcs.filter((_, i) => i !== sel) });
    setSel(Math.max(0, sel - 1));
  }

  async function publish() {
    if (!content) return;
    let next = content;
    if (tab === 'life') {
      try { const life: unknown = JSON.parse(lifeDraft); next = { ...content, baseLife: (life ?? undefined) as GameContent['baseLife'] }; } catch (e) { setMessage(`Base life JSON: ${String(e)}`); return; }
    }
    const r = validateContent(next);
    if (!r.ok) { setMessage(r.errors.join('\n')); return; }
    setBusy(true);
    try {
      const saved = await studioSaveContent(r.content);
      setContent(saved);
      setLifeDraft(JSON.stringify(saved.baseLife ?? null, null, 2));
      setDirty(false);
      setMessage('Published — players get the new content immediately.');
    } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 20, zIndex: 100, background: '#172126', color: '#e8eef2', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <h2 style={{ margin: 0, flex: 1, whiteSpace: 'nowrap', fontSize: 20 }}>Quests & NPCs {dirty && <small style={{ color: '#e0b050' }}>· unsaved</small>}</h2>
        {(['quests', 'npcs', 'life'] as const).map((t) => <button key={t} className="btn" style={{ opacity: tab === t ? 1 : 0.55 }} onClick={() => { setTab(t); setSel(0); }}>{t === 'quests' ? `Quests (${content?.quests.length ?? 0})` : t === 'npcs' ? `NPCs (${content?.npcs.length ?? 0})` : 'Base life'}</button>)}
        <button className="btn" disabled={busy || !content} onClick={() => void publish()}>Validate & publish</button>
        <button className="btn" onClick={() => { if (!dirty || confirm('Discard unsaved changes?')) setOpen(false); }}>Close</button>
      </div>
      {!content ? <p>Loading…</p> : tab === 'life' ? (
        <>
          <p style={{ margin: 0, fontSize: 13, color: '#9fb3c0' }}>Farming plots, crops, animals, recipes, trades, foods and stamina tuning (positions are camp-local metres). Use <code>null</code> for the built-in defaults.</p>
          <textarea spellCheck={false} value={lifeDraft} onChange={(e) => { setLifeDraft(e.target.value); setDirty(true); }} style={{ flex: 1, fontFamily: 'monospace', color: '#eee', background: '#10171b' }} />
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0 }}>
          <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input style={S.input} placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn" onClick={() => add(false)}>New</button>
              <button className="btn" disabled={!current} onClick={() => add(true)}>Duplicate</button>
              <button className="btn" disabled={!current} onClick={remove}>Delete</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {shown.map(({ x, i }) => {
                const q = tab === 'quests' ? (x as QuestDef) : null;
                return (
                  <div key={i} onClick={() => setSel(i)} style={{ padding: '5px 8px', cursor: 'pointer', borderRadius: 4, background: i === sel ? '#2c4250' : undefined, opacity: q && !q.enabled ? 0.5 : 1, fontSize: 13 }}>
                    {q ? <>{q.kind === 'daily' ? '◷' : '◆'} <b>{q.npc}</b> · {q.title}</> : <><b>{(x as NpcDef).name}</b> <small>({x.id})</small></>}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', paddingRight: 6 }}>
            {current && tab === 'quests' && <QuestForm q={current as QuestDef} npcs={content.npcs.map((n) => n.id)} questIds={content.quests.map((q) => q.id)} onChange={(q) => update({ ...content, quests: content.quests.map((x, i) => (i === sel ? q : x)) })} />}
            {current && tab === 'npcs' && <NpcForm n={current as NpcDef} onChange={(n) => update({ ...content, npcs: content.npcs.map((x, i) => (i === sel ? n : x)) })} />}
          </div>
        </div>
      )}
      {(errors.length > 0 || message) && (
        <pre role="status" style={{ whiteSpace: 'pre-wrap', maxHeight: 110, overflow: 'auto', margin: 0, fontSize: 12, color: errors.length ? '#ff8a7a' : '#8fe09a' }}>{errors.length ? `${errors.length} problem(s):\n${errors.join('\n')}` : message}</pre>
      )}
    </div>
  );
}
