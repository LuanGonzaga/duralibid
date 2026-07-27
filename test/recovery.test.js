import assert from 'node:assert/strict';
import test from 'node:test';

import { nextStage, subjectForStage } from '../api/pix-recovery.js';

function lead(minutesAgo, recoveryStage = 0) {
  return {
    pix_generated_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    recovery_stage: recoveryStage,
  };
}

test('Pix recovery advances through three timed contacts', () => {
  assert.equal(nextStage(lead(9, 0)), 0);
  assert.equal(nextStage(lead(10, 0)), 1);
  assert.equal(nextStage(lead(24, 1)), 0);
  assert.equal(nextStage(lead(25, 1)), 2);
  assert.equal(nextStage(lead(44, 2)), 0);
  assert.equal(nextStage(lead(45, 2)), 3);
  assert.equal(nextStage(lead(120, 3)), 0);
});

test('each recovery stage has a distinct purpose', () => {
  assert.match(subjectForStage(1), /pronto/i);
  assert.match(subjectForStage(2), /vencer/i);
  assert.match(subjectForStage(3), /novo código/i);
});

