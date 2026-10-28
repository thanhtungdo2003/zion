import { MATERIAL_PRESETS } from './materials';

/**
 * Reference knowledge the agent's `research` tool searches: building dimensions, the game's
 * player limits, PBR measured values, and how each kind of asset is best built here. Short,
 * sourced from building codes and PBR practice, so the agent grounds sizes and material values
 * instead of inventing them.
 */
export interface KnowledgeEntry { topic: string; keywords: string[]; text: string }

export const KNOWLEDGE: readonly KnowledgeEntry[] = [
  { topic: 'Kích thước nhà ở', keywords: ['house', 'nhà', 'room', 'phòng', 'ceiling', 'trần', 'storey', 'tầng', 'dimension'], text: 'Chiều cao thông thủy phòng 2.6–2.8 m; tầng (sàn tới sàn) 2.9–3.2 m; tường ngoài 0.2–0.3 m, vách trong 0.1–0.15 m. Phòng khách 18–30 m², phòng ngủ 10–16 m², bếp 8–14 m², phòng ăn 10–14 m², phòng tắm 4–7 m². Nhà 1 tầng 60–100 m².' },
  { topic: 'Cửa đi, cửa sổ', keywords: ['door', 'cửa', 'window', 'cửa sổ', 'opening'], text: 'Cửa đi 0.8–1.0 × 2.0–2.2 m (cửa chính 1.0–1.2 m). Cửa sổ 0.9–1.5 m rộng, bậu 0.8–1.0 m (bếp 1.0–1.2 m, phòng tắm 1.4–1.6 m với cửa 0.6 m). Cửa cách góc tường ≥ 0.3 m.' },
  { topic: 'Cầu thang', keywords: ['stairs', 'cầu thang', 'step', 'bậc', 'riser', 'tread'], text: 'Bậc cao 15–19 cm, mặt bậc 25–30 cm (2R + G ≈ 63 cm), rộng ≥ 0.9 m; khoảng không trên đầu ≥ 2.0 m; lan can cao 0.9–1.0 m. Nhân vật game bước được tối đa 0.45 m và đi được dốc ≤ 45°.' },
  { topic: 'Giới hạn nhân vật game', keywords: ['player', 'character', 'nhân vật', 'collision', 'va chạm', 'walk'], text: 'Nhân vật: bán kính 0.35 m, cao 1.8 m, mắt 1.62 m, bước 0.45 m, dốc đi được ≤ 45.6°. Cửa cần ≥ 0.82 m rộng và ≥ 1.9 m cao để lọt; hành lang ≥ 0.9 m. Model xuất bản va chạm bằng chính tam giác đục có texture của nó.' },
  { topic: 'Mái nhà', keywords: ['roof', 'mái', 'gable', 'hip', 'ngói', 'tôn'], text: 'Mái ngói dốc 30–45°, mái tôn 10–20°, mái bằng có tường chắn mái 0.5–1.0 m. Mái đua ra 0.3–0.6 m. Đầu hồi đóng tam giác giữa tường và mái dốc hai phía.' },
  { topic: 'Nội thất', keywords: ['furniture', 'nội thất', 'sofa', 'bed', 'giường', 'table', 'bàn', 'kitchen', 'bếp'], text: 'Bàn 72–76 cm, ghế ngồi 43–47 cm, tủ bếp 90 cm sâu 60 cm, giường đôi 160×200 cm, sofa 3 chỗ 200×90 cm. Lối đi quanh giường/bàn ≥ 0.6 m; không chặn cửa (giữ trống 1 m trước cửa).' },
  { topic: 'Đá tự nhiên (procedural)', keywords: ['rock', 'đá', 'boulder', 'cliff', 'stone'], text: 'Đá: lưới icosphere đẩy bằng nhiễu fractal (fBm) vài octave + nhiễu ridged cho mặt gãy sắc, kéo về các lớp trầm tích (terrace) hơi nghiêng, đáy phẳng chìm vào đất 5–10%. Vật liệu: roughness 0.75–0.95, metalness 0, normal mạnh, AO theo hốc; rêu ở mặt trên/khe.' },
  { topic: 'PBR cơ bản', keywords: ['pbr', 'material', 'vật liệu', 'roughness', 'metallic', 'albedo'], text: 'Metalness gần như nhị phân: kim loại trần 1, mọi thứ khác (sơn, gỉ, gỗ, đá, nhựa) 0; giá trị giữa chỉ ở vùng chuyển tiếp. Albedo phi kim 4–90% (than 4%, bê tông 25–35%, tuyết 85%). Roughness theo độ nhám thật: kính 0–0.1, gốm men 0.2–0.4, gỗ phủ 0.4–0.6, gạch 0.7–0.9, đá/đất 0.8–1. Bụi, rêu, oxy hóa làm tăng roughness.' },
  { topic: 'Phong hóa / bỏ hoang', keywords: ['abandoned', 'bỏ hoang', 'ruin', 'damage', 'hư hỏng', 'moss', 'rêu', 'old', 'cũ'], text: 'Bỏ hoang hàng trăm năm: mái sập từng mảng (bắt đầu ở nóc và chỗ đọng nước), cửa kính vỡ, tường nứt theo đường chéo từ góc cửa, rêu ở mặt hướng bắc và chân tường, bụi tích trong hốc, đồ đạc đổ, gạch vụn trên sàn, cây bụi mọc quanh nhà, hàng rào nghiêng/mất đoạn.' },
  { topic: 'Tối ưu cho game', keywords: ['optimize', 'tối ưu', 'draw call', 'lod', 'performance', 'triangles'], text: 'Mỗi vật liệu là một draw call sau khi gộp; tái dùng vật liệu giữa các phần. Model nhà 5–40k tam giác; đá 1–5k. Đồ nội thất/cây dùng model sẵn có của game được vẽ instanced chung với cả bản đồ. Texture 512² cho bề mặt lớn, 256² cho chi tiết nhỏ.' },
  { topic: 'Bố cục sân vườn', keywords: ['yard', 'sân', 'garden', 'vườn', 'fence', 'hàng rào', 'path'], text: 'Sân trước 4–8 m với lối đi 1–1.5 m từ cổng tới cửa chính; sân sau 6–12 m (vườn rau, cây ăn quả, kho). Hàng rào gỗ 1.0–1.2 m, cột cách 2–2.5 m, cổng 1.2–1.6 m.' },
];

export function searchKnowledge(query: string, limit = 4): KnowledgeEntry[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const scored = KNOWLEDGE.map((k) => ({ k, s: words.reduce((s, w) => s + (k.keywords.some((x) => x.includes(w) || w.includes(x)) ? 2 : 0) + (k.text.toLowerCase().includes(w) ? 1 : 0), 0) }));
  const presets = MATERIAL_PRESETS.filter((p) => words.some((w) => p.keywords.some((k) => k.includes(w)))).slice(0, 3)
    .map((p) => ({ topic: `Vật liệu ${p.name} (${p.id})`, keywords: p.keywords, text: `${p.note} Màu ${p.color}, roughness ${p.roughness} (${p.range.roughness.join('–')}), metalness ${p.metalness}, pattern ${p.pattern}, ô ${p.scale} m.` }));
  return [...scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.k), ...presets].slice(0, limit + presets.length);
}
