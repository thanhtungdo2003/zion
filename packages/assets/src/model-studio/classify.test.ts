import { describe, expect, it } from 'vitest';
import { emptyDoc } from './doc';
import { classifyModel } from './classify';
import { generateHouse } from './house';

const doc = (name: string, kind: Parameters<typeof emptyDoc>[1] = 'other', notes = '') => { const d = emptyDoc(name, kind); if (notes) d.notes = notes; return d; };

describe('model studio: the model sorts itself out', () => {
  it('tells buildings from vehicles, furniture, plants and rocks', () => {
    expect(classifyModel(doc('Xe tải quân sự')).kind).toBe('vehicle');
    expect(classifyModel(doc('Bộ bàn ghế gỗ')).kind).toBe('furniture');
    expect(classifyModel(doc('Cây bàng')).kind).toBe('vegetation');
    expect(classifyModel(doc('Tảng đá lớn')).kind).toBe('rock');
    expect(classifyModel(doc('Xe tải quân sự')).fit).toBeNull();
    const h = emptyDoc('Mẫu', 'other');
    generateHouse(h, { seed: 3, floors: 1 });
    expect(classifyModel(h).kind).toBe('building');
  });

  it('places a building by its use, condition and kind of area', () => {
    expect(classifyModel(doc('Doanh trại bỏ hoang')).fit).toMatchObject({ lots: ['military'], conditions: ['abandoned'], areas: expect.arrayContaining(['military-base']) });
    const tube = classifyModel(doc('Nhà ống mặt phố', 'building')).fit!;
    expect(tube.lots).toEqual(expect.arrayContaining(['residential', 'commercial']));
    expect(tube.areas).toEqual(expect.arrayContaining(['vn-town']));
    const ruin = classifyModel(doc('Nhà máy đổ nát', 'building')).fit!;
    expect(ruin.lots).toContain('industrial');
    expect(ruin.conditions).toContain('ruined');
    expect(ruin.areas).toEqual(expect.arrayContaining(['industrial-zone']));
    // A plain house: intact, a home, anywhere.
    expect(classifyModel(doc('Ngôi nhà', 'building')).fit).toEqual({ lots: ['residential'], conditions: ['intact'], areas: [], types: ['house'] });
    // What it is: the building types the World Studio asks for.
    expect(classifyModel(doc('Trường tiểu học 2 tầng', 'building')).fit!.types).toEqual(['school']);
    expect(classifyModel(doc('Bệnh viện đa khoa', 'building')).fit!.types).toEqual(['hospital']);
    expect(classifyModel(doc('Trường đại học', 'building')).fit!.types).toEqual(['university']);
    // The request in the notes counts too.
    expect(classifyModel(doc('Công trình 1', 'building', 'nhà gỗ ở làng quê, bỏ hoang 50 năm')).fit).toMatchObject({ conditions: ['abandoned'], areas: expect.arrayContaining(['small-village', 'abandoned-settlement']) });
  });
});
