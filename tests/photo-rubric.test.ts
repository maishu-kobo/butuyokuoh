import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHOTO_SCORECARDS, scorePhoto } from './eval/photo-search/rubric';

test('the rubric max is 84 after A.L.B, HP, and Coty count as brands', () => {
  assert.equal(PHOTO_SCORECARDS.length, 23);
  const branded = PHOTO_SCORECARDS.filter((card) => card.brand !== null);
  assert.equal(branded.length, 15);
  assert.equal(PHOTO_SCORECARDS.reduce((sum, card) => sum + 3 + (card.brand ? 1 : 0), 0), 84);
  const doc = readFileSync(new URL('../docs/capture-ai.md', import.meta.url), 'utf8');
  assert.equal(doc.includes('満点は 92'), false);
  assert.equal(doc.includes('満点は 84'), true);
  for (const id of ['alb-wristwatch', 'broken-laptop-2006', 'coty-suma-perfume']) {
    assert.equal(PHOTO_SCORECARDS.find((card) => card.id === id)?.brand == null, false, id);
  }
});

test('a sure A.L.B, HP, or Coty guess scores the brand, and MLB on the watch does not', () => {
  const alb = scorePhoto({
    id: 'alb-wristwatch',
    confidence: 'sure',
    name: 'A.L.B 腕時計',
    brand: 'A.L.B',
    hits: 2,
    top3: ['A.L.B 腕時計 シルバー'],
  });
  assert.equal(alb.brand, true);
  assert.equal(alb.noWrongBrand, true);
  assert.equal(alb.category, true);
  assert.equal(alb.points, 4);

  const dotted = scorePhoto({
    id: 'alb-wristwatch',
    confidence: 'sure',
    name: 'ALB 時計',
    brand: 'ALB',
    hits: 1,
    top3: ['腕時計'],
  });
  assert.equal(dotted.brand, true);
  assert.equal(dotted.noWrongBrand, true);

  const mlb = scorePhoto({
    id: 'alb-wristwatch',
    confidence: 'sure',
    name: 'MLB 腕時計',
    brand: 'MLB',
    hits: 2,
    top3: ['腕時計'],
  });
  assert.equal(mlb.brand, false);
  assert.equal(mlb.noWrongBrand, false);

  const hp = scorePhoto({
    id: 'broken-laptop-2006',
    confidence: 'sure',
    name: 'HP ノートパソコン',
    brand: 'HP',
    hits: 1,
    top3: ['HP ノートパソコン'],
  });
  assert.equal(hp.brand, true);
  assert.equal(hp.noWrongBrand, true);
  assert.equal(hp.points, 4);

  const dell = scorePhoto({
    id: 'broken-laptop-2006',
    confidence: 'sure',
    name: 'Dell ノートパソコン',
    brand: 'Dell',
    hits: 1,
    top3: ['ノートパソコン'],
  });
  assert.equal(dell.brand, false);
  assert.equal(dell.noWrongBrand, false);

  const coty = scorePhoto({
    id: 'coty-suma-perfume',
    confidence: 'unsure',
    name: 'Coty Suma 香水',
    brand: 'Coty',
    hits: 1,
    top3: ['コティ 香水'],
  });
  assert.equal(coty.brand, true);
  assert.equal(coty.noWrongBrand, true);
  assert.equal(coty.points, 4);
});
