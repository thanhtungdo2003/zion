'use client';
import { useState } from 'react';
import { ARCHITECT_NAME, BLUEPRINTS, MATERIAL_COLOR, SUPPLY_CATALOG, VEHICLES, blueprintPieces, type BlueprintDef, type SupplyEntry } from '@zion/shared';
import type { InventoryState, InventoryStore } from '@/game/inventory/inventory';
import { ITEMS } from '@/game/inventory/items';
import { useSettings } from '@/lib/settings';
import { Icon } from './Icon';
import { Coins, ItemArt } from './Inventory';
import ModelPreview from './ModelPreview';

const MATERIAL_LABEL = { wood: 'Gỗ', stone: 'Đá', metal: 'Kim loại' } as const;
const TIER = { wood: 'Cấp I', stone: 'Cấp II', metal: 'Cấp III' } as const;

/** Units of a resource carried (stack counts; free issued kit does not count). */
function carried(state: InventoryState, itemId: string): number {
  const stack = ITEMS[itemId]?.stack;
  return state.items.filter((i) => i.itemId === itemId && !i.issued && !i.container.startsWith('stash')).reduce((n, i) => n + (stack ? i.count ?? stack : 1), 0);
}

/** Top-down schematic of a blueprint: its walls, door and core, drawn to scale. */
function Schematic({ def }: { def: BlueprintDef }) {
  const pieces = blueprintPieces(def).filter((p) => p.kind !== 'roof');
  const pad = 1, w = def.w + pad * 2, d = def.d + pad * 2;
  return (
    <svg className="bp-schematic" viewBox={`${-w / 2} ${-d / 2} ${w} ${d}`} aria-hidden="true">
      <defs>
        <pattern id={`grid-${def.id}`} width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="rgba(120,190,255,.16)" strokeWidth=".04" /></pattern>
      </defs>
      <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={`url(#grid-${def.id})`} />
      <rect x={-def.w / 2} y={-def.d / 2} width={def.w} height={def.d} fill="rgba(58,160,255,.08)" stroke="rgba(124,196,255,.5)" strokeWidth=".06" strokeDasharray=".3 .2" />
      {pieces.map((p, i) => (
        <rect key={i} x={p.x - p.hx} y={p.z - p.hz} width={p.hx * 2} height={p.hz * 2}
          fill={p.kind === 'door' ? '#ffb000' : p.kind === 'core' ? '#39ff8a' : p.kind === 'pillar' ? '#9ed4ff' : '#5aa0ea'}
          opacity={p.y + p.hy < 1.6 && p.kind === 'wall' ? .55 : 1} />
      ))}
      <text x="0" y={-def.d / 2 - .25} textAnchor="middle" fontSize=".55" fill="#9ed4ff">{def.w} × {def.d} m</text>
    </svg>
  );
}

/**
 * The architect's drafting table: each blueprint with the materials it wants, a bar per material
 * filling as they are handed in (button gives what you carry), and the claim button once complete.
 */
export function BlueprintPanel({ state, store }: { state: InventoryState; store: InventoryStore }) {
  const { item } = useSettings();
  const [pick, setPick] = useState(BLUEPRINTS[0]!.id);
  const def = BLUEPRINTS.find((b) => b.id === pick) ?? BLUEPRINTS[0]!;
  const given = state.blueprints.find((p) => p.id === def.id)?.given ?? {};
  const entries = Object.entries(def.cost);
  const total = entries.reduce((n, [, v]) => n + v, 0);
  const done = entries.reduce((n, [k, v]) => n + Math.min(v, given[k] ?? 0), 0);
  const complete = done >= total;
  return (
    <section className="inv-box tech-panel bp-panel" onMouseDown={(e) => e.stopPropagation()}>
      <header className="tech-head">
        <span><Icon name="lucide:drafting-compass" /> {ARCHITECT_NAME}</span>
        <small>XƯỞNG BẢN VẼ · ĐỔI VẬT LIỆU LẤY BẢN VẼ</small>
      </header>
      <nav className="bp-tabs">
        {BLUEPRINTS.map((b) => {
          const g = state.blueprints.find((p) => p.id === b.id)?.given ?? {};
          const tt = Object.values(b.cost).reduce((n, v) => n + v, 0), dd = Object.entries(b.cost).reduce((n, [k, v]) => n + Math.min(v, g[k] ?? 0), 0);
          return (
            <button key={b.id} className={b.id === def.id ? 'on' : ''} onClick={() => setPick(b.id)} style={{ ['--mat' as string]: MATERIAL_COLOR[b.material] }}>
              <b>{b.name}</b>
              <small>{TIER[b.material]} · {MATERIAL_LABEL[b.material]}</small>
              <i className="tech-bar"><span style={{ width: `${(dd / tt) * 100}%` }} /></i>
            </button>
          );
        })}
      </nav>
      <div className="bp-body">
        <div className="bp-views">
          <div className="bp-model"><ModelPreview key={def.id} model={{ structure: def.id }} title={def.name} /></div>
          <Schematic def={def} />
        </div>
        <div className="bp-info">
          <h3>{def.name}</h3>
          <p>{def.description}</p>
          <ul className="bp-specs">
            <li><span>Vật liệu</span><b style={{ color: MATERIAL_COLOR[def.material] }}>{MATERIAL_LABEL[def.material]}</b></li>
            <li><span>Kích thước</span><b>{def.w} × {def.d} × {def.h} m</b></li>
            <li><span>Năng lượng</span><b className="bp-core">Lõi pin hạt nhân</b></li>
          </ul>
        </div>
      </div>
      <div className="bp-costs">
        {entries.map(([id, need]) => {
          const have = carried(state, id), got = Math.min(need, given[id] ?? 0), def2 = ITEMS[id];
          if (!def2) return null;
          return (
            <div key={id} className={`bp-cost${got >= need ? ' full' : ''}`}>
              <span className="bp-art" style={{ background: def2.color }}><ItemArt def={def2} /></span>
              <span className="bp-name">{item(id)}<small>Đang mang: {have}</small></span>
              <span className="bp-meter"><i className="tech-bar"><span style={{ width: `${(got / need) * 100}%` }} /></i><small>{got} / {need}</small></span>
              <button className="btn tech-btn" disabled={got >= need || have <= 0} onClick={() => store.onDeposit?.(def.id, id)}>{got >= need ? <Icon name="lucide:check" /> : 'Giao'}</button>
            </div>
          );
        })}
      </div>
      <footer className="bp-foot">
        <span className="bp-total"><i className="tech-bar big"><span style={{ width: `${(done / total) * 100}%` }} /></i><small>{Math.round((done / total) * 100)}% vật liệu</small></span>
        <button className={`btn tech-btn claim${complete ? ' ready' : ''}`} disabled={!complete} onClick={() => store.onClaim?.(def.id)}><Icon name="lucide:scroll" /> Nhận bản vẽ</button>
      </footer>
      <p className="tech-note">Chuột phải vào bản vẽ trong túi để đặt công trình · lăn chuột xoay · chuột trái xây · không xây trong 100 m quanh căn cứ chính.</p>
    </section>
  );
}

const KIND_LABEL: Record<SupplyEntry['kind'], string> = { vehicle: 'Xe cộ', weapons: 'Vũ khí', ammo: 'Đạn & y tế' };

/** The supply radio: pick a package, pay in ZCoin, and a transport plane flies it to the red X. */
export function SupplyPanel({ coins, store }: { coins: number; store: InventoryStore }) {
  const { item } = useSettings();
  const [kind, setKind] = useState<SupplyEntry['kind']>('vehicle');
  const [pickId, setPick] = useState<string | null>(null);
  const list = SUPPLY_CATALOG.filter((e) => e.kind === kind);
  const picked = list.find((e) => e.id === pickId) ?? list[0]!;
  const preview = picked.vehicle ? { asset: VEHICLES[picked.vehicle].asset } : { item: picked.items![0]![0] };
  return (
    <section className="inv-box tech-panel supply-panel" onMouseDown={(e) => e.stopPropagation()}>
      <header className="tech-head">
        <span><Icon name="game-icons:radio-tower" /> GỌI TIẾP TẾ · VỆ TINH</span>
        <Coins n={coins} />
      </header>
      <nav className="bp-tabs supply-tabs">
        {(['vehicle', 'weapons', 'ammo'] as const).map((k) => <button key={k} className={k === kind ? 'on' : ''} onClick={() => { setKind(k); setPick(null); }}><b>{KIND_LABEL[k]}</b></button>)}
      </nav>
      <div className="supply-preview">
        <div className="bp-model"><ModelPreview key={picked.id} model={preview} title={picked.name} /></div>
        <div className="supply-contents">
          <b>{picked.name}</b>
          {picked.items ? picked.items.map(([id, n]) => {
            const d = ITEMS[id];
            return d ? <span key={id} className="supply-item"><span className="bp-art" style={{ background: d.color }}><ItemArt def={d} /></span>{n}× {item(id)}</span> : null;
          }) : <small>Thả riêng bằng dù · lái được ngay khi chạm đất</small>}
        </div>
      </div>
      <div className="supply-list">
        {list.map((e) => (
          <div key={e.id} className={`supply-row${e.id === picked.id ? ' on' : ''}`} onClick={() => setPick(e.id)}>
            <span className="supply-icon"><Icon name={e.icon} /></span>
            <span className="supply-name">
              <b>{e.name}</b>
              <small>{e.vehicle ? 'Thả riêng bằng dù · lái được ngay khi chạm đất' : e.items?.map(([id, n]) => `${n}× ${item(id)}`).join(' · ')}</small>
            </span>
            <Coins n={e.price} className={coins >= e.price ? '' : 'short'} />
            <button className="btn tech-btn" disabled={coins < e.price} onClick={() => store.onOrder?.(e.id)}><Icon name="lucide:plane" /> Đặt</button>
          </div>
        ))}
      </div>
      <p className="tech-note warn"><Icon name="lucide:triangle-alert" /> Hàng được thả bằng dù xuống ngay chỗ bạn đứng lúc gọi (đánh dấu <b>X đỏ</b>). Điểm thả không được bảo vệ: zombie và người chơi khác có thể tới trước bạn.</p>
    </section>
  );
}
