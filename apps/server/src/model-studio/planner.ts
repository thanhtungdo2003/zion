import type { CatalogAsset, ModelDoc } from '@zion/assets/model-studio';

/**
 * The agent's built-in planner (no language model): reads the common requests — a house with its
 * rooms, style, storeys and age; a rock or a rock formation; a building assembled from the game's
 * modular wall, sill, lintel and slab pieces — in Vietnamese or English, and turns them into
 * the same tool calls the AI agent makes (research, create, materials, validate, fix, optimise).
 */
export interface PlannedStep { thought?: string; tool: string; args: unknown | ((doc: ModelDoc) => unknown) }
export interface Plan { plan: string[]; steps: PlannedStep[]; reason?: string }

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));
const num = (t: string, re: RegExp) => { const m = re.exec(t); return m ? Number(m[1]) : undefined; };
const WORD_NUM: Record<string, number> = { 'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'năm': 5, one: 1, two: 2, three: 3, four: 4 };

function count(t: string, nouns: string[]): number {
  let n = 0;
  for (const noun of nouns) {
    const re = new RegExp(`(\\d+|một|hai|ba|bốn|one|two|three|four)\\s+${noun}`, 'g');
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = re.exec(t))) { n += Number(m[1]) || WORD_NUM[m[1]!] || 1; found = true; }
    if (!found && t.includes(noun)) n += 1;
  }
  return n;
}

export function offlinePlan(prompt: string, assets: CatalogAsset[]): Plan {
  const t = prompt.toLowerCase();
  const kit = has(t, 'mảng tường', 'model tường', 'wall pieces', 'from the existing', 'từ các model', 'lắp ghép thành', 'assemble');
  if (kit) return kitHousePlan(t, assets);
  if (has(t, 'nhà', 'house', 'home', 'cabin', 'villa', 'biệt thự', 'căn hộ')) return housePlan(t);
  if (has(t, 'đá', 'rock', 'boulder', 'stone', 'cliff', 'vách')) return rockPlan(t);
  return { plan: [], steps: [], reason: 'Chế độ offline chỉ hiểu yêu cầu tạo nhà, đá/cụm đá, hoặc lắp nhà từ model tường có sẵn. Cấu hình AI_API_KEY trên server để agent hiểu mọi yêu cầu.' };
}

function housePlan(t: string): Plan {
  const years = num(t, /(\d+)\s*(?:năm|years?)/) ?? (has(t, 'bỏ hoang', 'abandoned', 'đổ nát', 'ruin') ? 120 : has(t, 'cũ', 'old') ? 40 : 0);
  const villa = has(t, 'biệt thự', 'villa', 'mansion', 'sang trọng', 'luxury', 'cao cấp');
  const factory = has(t, 'xưởng', 'nhà máy', 'factory', 'warehouse', 'kho hàng', 'industrial');
  const style = has(t, 'hậu tận thế', 'post-apoc', 'postapoc', 'apocalyp', 'sinh tồn', 'survival') || years >= 100 || (factory && years > 0) ? 'postapoc' : villa || has(t, 'hiện đại', 'modern') ? 'modern' : has(t, 'đá', 'stone', 'cottage', 'nhà gỗ') ? 'cottage' : 'rural';
  const floors = has(t, '2 tầng', 'hai tầng', 'two-storey', 'two story', '2-storey', 'upstairs', 'tầng lầu') || villa ? 2 : has(t, '1 tầng', 'một tầng', 'nhà cấp 4', 'single-storey', 'bungalow') ? 1 : undefined;
  // Real texture sets that fit the request (the house generator's material ids).
  const ruined = years >= 60 || style === 'postapoc';
  const looks: Array<[string, string, string]> = villa
    ? [['tuong-ngoai', 'smooth white plaster wall', 'Tường vữa trắng mịn'], ['tuong-trong', 'clean painted plaster', 'Tường trong sơn'], ['san-go', 'marble floor tiles', 'Sàn đá cẩm thạch'], ['mai', 'polished concrete', 'Mái bê tông mịn'], ['go-vien', 'dark wood', 'Gỗ tối màu']]
    : ruined
      ? [['tuong-ngoai', factory ? 'cracked dirty concrete wall' : 'dirty damaged brick wall', 'Tường cũ nứt bẩn'], ['tuong-trong', 'peeling paint plaster wall', 'Tường trong bong tróc'], ['san-go', 'dirty concrete floor', 'Sàn bê tông bẩn'], ['mai', 'rusty corrugated metal', 'Mái tôn gỉ'], ['go-vien', 'weathered wood planks', 'Gỗ phong hóa']]
      : style === 'cottage'
        ? [['tuong-ngoai', 'stone wall', 'Tường đá'], ['san-go', 'wood floor planks', 'Sàn gỗ'], ['mai', 'roof shingles', 'Mái ngói'], ['go-vien', 'wood planks', 'Gỗ']]
        : [['tuong-ngoai', 'plaster wall', 'Tường vữa'], ['san-go', 'wood floor', 'Sàn gỗ'], ['mai', 'roof tiles', 'Mái ngói'], ['go-vien', 'wood planks', 'Gỗ']];
  const textureSteps: PlannedStep[] = looks.map(([material, query, name], i) => ({ ...(i === 0 ? { thought: 'Chọn bộ texture thật hợp phong cách cho từng bề mặt chính.' } : {}), tool: 'download_texture', args: { material, query, name } }));
  const rooms: string[] = [];
  if (has(t, 'phòng khách', 'living')) rooms.push('living');
  const bedrooms = count(t, ['phòng ngủ', 'bedroom', 'bedrooms']);
  for (let i = 0; i < Math.min(4, bedrooms); i++) rooms.push('bedroom');
  if (has(t, 'bếp', 'kitchen')) rooms.push('kitchen');
  if (has(t, 'phòng ăn', 'dining')) rooms.push('dining');
  if (has(t, 'phòng tắm', 'nhà tắm', 'wc', 'toilet', 'bathroom')) rooms.push('bathroom');
  if (has(t, 'kho', 'storage')) rooms.push('storage');
  const full = rooms.length >= 2 || has(t, 'hoàn chỉnh', 'complete');
  const roomList = full ? (rooms.includes('living') ? rooms : ['living', ...rooms]) : ['living', 'kitchen', 'dining', 'bedroom', 'bedroom', 'bathroom'];
  if (full && !roomList.includes('bathroom') && roomList.length >= 4) roomList.push('bathroom');
  const furniture = !has(t, 'không nội thất', 'no furniture', 'trống');
  const yard = !has(t, 'không sân', 'no yard');
  const fence = has(t, 'hàng rào', 'fence') || yard;
  const garden = has(t, 'vườn', 'garden', 'cây') || yard;
  const seed = Math.abs([...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 100000;
  return {
    plan: [
      `Tra cứu kích thước kiến trúc và vật liệu cho nhà ${style === 'postapoc' ? 'hậu tận thế' : style}.`,
      `Dựng nhà ${floors ?? 'tự chọn số'} tầng: ${roomList.join(', ')}${furniture ? ' có nội thất' : ''}${yard ? ', sân' : ''}${fence ? ', hàng rào' : ''}${garden ? ', vườn' : ''}${years ? `, bỏ hoang ${years} năm` : ''}.`,
      'Kiểm tra theo game (cửa, cầu thang, va chạm, kích thước), tự sửa lỗi.',
      'Đánh giá tối ưu (draw call, tam giác) và đặt loại lô đất để dùng trong map.',
    ],
    steps: [
      { thought: 'Lấy chuẩn kích thước phòng, cửa, cầu thang và giới hạn nhân vật trước khi dựng.', tool: 'research', args: { query: 'house room door stairs player' } },
      { tool: 'research', args: { query: years > 50 ? 'abandoned ruin moss damage' : 'pbr material wood plaster brick' } },
      { thought: 'Dựng toàn bộ căn nhà bằng bộ sinh nhà (phòng nối bằng cửa, cửa sổ theo phòng, sàn, trần, mái, nội thất, sân vườn).', tool: 'create_geometry', args: { type: 'house', name: years >= 100 ? 'Nhà bỏ hoang' : 'Ngôi nhà', params: { style, ...(floors ? { floors } : {}), rooms: roomList, abandonedYears: years, furniture, yard, fence, garden, seed } } },
      ...textureSteps,
      { tool: 'set_model_info', args: { kind: 'building', notes: t.slice(0, 4000) } },
      { thought: 'Tự phân loại: loại lô, tình trạng và kiểu khu vực để World Studio đặt đúng chỗ.', tool: 'classify_model', args: { apply: true } },
      { thought: 'Kiểm tra như game sẽ dùng.', tool: 'validate_asset', args: {} },
      { tool: 'auto_fix', args: {} },
      { tool: 'optimize_model', args: { action: 'merge_materials' } },
      { tool: 'optimize_model', args: { action: 'report' } },
    ],
  };
}

function rockPlan(t: string): Plan {
  const big = has(t, 'lớn', 'khổng lồ', 'big', 'large', 'huge', 'giant');
  const cluster = has(t, 'cụm', 'nhiều', 'cluster', 'formation', 'group');
  const size = num(t, /(\d+(?:\.\d+)?)\s*m\b/) ?? (big ? 4.5 : 2.2);
  const layered = has(t, 'lớp', 'layer', 'strata', 'trầm tích') ? .7 : .35;
  const jagged = has(t, 'lởm chởm', 'jagged', 'sắc', 'rough') ? .85 : .55;
  const moss = has(t, 'rêu', 'moss') ? .55 : .15;
  const seed = Math.abs([...t].reduce((h, c) => (h * 33 + c.charCodeAt(0)) | 0, 5)) % 100000;
  const sandstone = has(t, 'sa thạch', 'sandstone', 'vàng');
  return {
    plan: ['Tra cứu cách dựng đá tự nhiên và thông số PBR của đá.', `Tạo ${cluster ? 'cụm đá' : 'tảng đá'} ~${size} m, bề mặt ${jagged > .7 ? 'lởm chởm' : 'tự nhiên'}, ${layered > .5 ? 'nhiều lớp' : 'ít lớp'}.`, 'Vật liệu đá PBR (roughness cao, metalness 0, normal mạnh, rêu/khe nứt).', 'Kiểm tra và tối ưu.'],
    steps: [
      { tool: 'research', args: { query: 'rock procedural pbr' } },
      { thought: 'Vật liệu đá trước, để tảng đá dùng ngay.', tool: 'create_or_edit_material', args: { id: 'da', preset: sandstone ? 'rock_sandstone' : 'rock_granite', name: sandstone ? 'Đá sa thạch' : 'Đá granite', texture: { moss, cracks: .08, dirt: .25, scale: Math.max(1.5, size * .8), variation: .55 } } },
      cluster
        ? { tool: 'create_geometry', args: { type: 'rock_formation', name: 'Cụm đá', material: 'da', params: { size, count: 5, seed, roughness: jagged, layers: layered } } }
        : { tool: 'create_geometry', args: { type: 'rock', name: 'Tảng đá', material: 'da', params: { width: size, height: size * .7, depth: size * .85, roughness: jagged, layers: layered, detail: 4, seed } } },
      { tool: 'set_model_info', args: { kind: 'rock' } },
      { tool: 'generate_or_apply_texture', args: { material: 'da', resolution: big ? 1024 : 512 } },
      { tool: 'validate_asset', args: {} },
      { tool: 'auto_fix', args: {} },
    ],
  };
}

/**
 * A building assembled from the game's own modular pieces (walls, window sills, lintels, floor
 * and roof slabs, steps): a rectangle of wall bays with windows, a doorway on the front, slabs —
 * every piece a reference to the shared model, so the whole house draws in a few instanced calls.
 */
function kitHousePlan(t: string, assets: CatalogAsset[]): Plan {
  const find = (key: string) => assets.find((a) => a.key === key);
  const wall = find('street.wall_b') ?? find('street.wall_a'), sill = find('street.sill_b') ?? find('street.sill_a'), head = find('street.head_b') ?? find('street.head_a');
  const slab = find('street.slab'), roof = find('street.roof'), parapet = find('street.parapet_b') ?? find('street.parapet_a');
  if (!wall || !sill || !head || !slab || !roof) return { plan: [], steps: [], reason: 'Không tìm thấy bộ model tường/bậu/lanh tô/sàn trong thư viện game.' };
  const floors = has(t, '2 tầng', 'hai tầng', 'two') ? 2 : 1;
  // Bay width from the wall piece (its footprint radius ≈ half its width).
  const bay = Math.max(.8, Math.round(wall.radius * 2 * 10) / 10), bh = wall.height;
  // About 9 × 7 m whatever the piece width (odd bay counts keep the door centred).
  const nx = Math.max(5, Math.round(9 / bay) | 1), nz = Math.max(5, Math.round(7 / bay) | 1), W = nx * bay, D = nz * bay;
  const parts: Array<{ asset: number; position: [number, number, number]; rotation?: [number, number, number]; name: string }> = [];
  for (let f = 0; f < floors; f++) {
    const y = f * (bh + .2);
    const side = (count: number, at: (i: number) => [number, number], yaw: number, door: number | null, windows: (i: number) => boolean) => {
      for (let i = 0; i < count; i++) {
        const [x, z] = at(i);
        if (f === 0 && i === door) { parts.push({ asset: head.id, position: [x, y + bh - head.height, z], rotation: [0, yaw, 0], name: 'Lanh tô cửa' }); continue; }
        if (windows(i)) {
          parts.push({ asset: sill.id, position: [x, y, z], rotation: [0, yaw, 0], name: 'Bậu cửa sổ' });
          parts.push({ asset: head.id, position: [x, y + bh - head.height, z], rotation: [0, yaw, 0], name: 'Lanh tô' });
        } else parts.push({ asset: wall.id, position: [x, y, z], rotation: [0, yaw, 0], name: 'Mảng tường' });
      }
    };
    const odd = (i: number) => i % 3 === 1;
    side(nx, (i) => [-W / 2 + bay * (i + .5), D / 2], 0, Math.floor(nx / 2), odd);
    side(nx, (i) => [-W / 2 + bay * (i + .5), -D / 2], 180, null, odd);
    side(nz, (i) => [W / 2, -D / 2 + bay * (i + .5)], 90, null, (i) => i % 3 === 1);
    side(nz, (i) => [-W / 2, -D / 2 + bay * (i + .5)], -90, null, (i) => i % 3 === 1);
    const sw = slab.radius * 2 / Math.SQRT2;
    for (let x = -W / 2 + sw / 2; x < W / 2; x += sw) for (let z = -D / 2 + sw / 2; z < D / 2; z += sw)
      parts.push({ asset: (f === floors - 1 ? roof : slab).id, position: [x, y + bh, z], name: f === floors - 1 ? 'Tấm mái' : 'Tấm sàn' });
  }
  if (parapet) {
    const top = (floors - 1) * (bh + .2) + bh + .2;
    for (let i = 0; i < nx; i++) for (const [z, yaw] of [[D / 2, 0], [-D / 2, 180]] as const) parts.push({ asset: parapet.id, position: [-W / 2 + bay * (i + .5), top, z], rotation: [0, yaw, 0], name: 'Tường chắn mái' });
    for (let i = 0; i < nz; i++) for (const [x, yaw] of [[W / 2, 90], [-W / 2, -90]] as const) parts.push({ asset: parapet.id, position: [x, top, -D / 2 + bay * (i + .5)], rotation: [0, yaw, 0], name: 'Tường chắn mái' });
  }
  const batches: typeof parts[] = [];
  for (let i = 0; i < parts.length; i += 150) batches.push(parts.slice(i, i + 150));
  return {
    plan: [
      'Tìm bộ model tường, bậu cửa sổ, lanh tô, sàn và mái có sẵn trong game.',
      `Lắp ${floors} tầng: ${nx}×${nz} khoang ${bay} m, cửa chính mặt trước, cửa sổ xen kẽ, sàn và mái phủ kín.`,
      'Mọi mảnh tham chiếu model gốc → vẽ instanced (vài draw call cho cả nhà), không nhân bản hình học.',
      'Kiểm tra và báo cáo.',
    ],
    steps: [
      { tool: 'search_assets', args: { query: 'wall sill lintel slab roof', limit: 20 } },
      { tool: 'inspect_model', args: { asset: wall.id } },
      ...batches.map((b, i) => ({ thought: i === 0 ? `Lắp ${parts.length} mảnh theo lưới ${bay} m.` : undefined, tool: 'assemble_model', args: { group: i === 0 ? 'Nhà lắp ghép' : `Nhà lắp ghép ${i + 1}`, parts: b } })),
      { tool: 'set_model_info', args: { kind: 'building' } },
      { tool: 'classify_model', args: { apply: true } },
      { tool: 'validate_asset', args: {} },
      { tool: 'optimize_model', args: { action: 'report' } },
    ],
  };
}
