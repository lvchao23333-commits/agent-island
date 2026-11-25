const test = require('node:test');
const assert = require('node:assert/strict');
const { StateTracker } = require('../src/stateTracker');
const { CodexMonitor } = require('../src/monitors/codexMonitor');
const { AntigravityMonitor } = require('../src/monitors/antigravityMonitor');

test('StateTracker does not fire alert on initial poll', () => {
  const tracker = new StateTracker();
  const res = tracker.update(
    [
      { id: 'codex:1', source: 'codex', title: 'Task A', status: 'waiting', detailStatus: 'completed', updatedAt: 1000 },
      { id: 'agy:2', source: 'antigravity', title: 'Task B', status: 'running', detailStatus: 'RUN_STATE_RUNNING', updatedAt: 2000 },
    ],
    5000
  );
  assert.equal(res.newlyFinished.length, 0);
  assert.equal(res.running.length, 1);
  assert.equal(res.waiting.length, 1);
});

test('StateTracker emits newlyFinished when running transitions to waiting', () => {
  const tracker = new StateTracker({ recentTtlMs: 30000 });
  tracker.update(
    [{ id: 'agy:2', source: 'antigravity', title: 'Task B', status: 'running', detailStatus: 'RUN_STATE_RUNNING', updatedAt: 2000 }],
    5000
  );

  const res = tracker.update(
    [{ id: 'agy:2', source: 'antigravity', title: 'Task B', status: 'waiting', detailStatus: 'RUN_STATE_IDLE', updatedAt: 6000 }],
    7000
  );

  assert.equal(res.newlyFinished.length, 1);
  assert.equal(res.newlyFinished[0].id, 'agy:2');
  assert.equal(res.recentFinished.length, 1);

  // Subsequent idle poll does not re-emit
  const res2 = tracker.update(
    [{ id: 'agy:2', source: 'antigravity', title: 'Task B', status: 'waiting', detailStatus: 'RUN_STATE_IDLE', updatedAt: 6000 }],
    8000
  );
  assert.equal(res2.newlyFinished.length, 0);
  assert.equal(res2.recentFinished.length, 1);

  // Expires after TTL
  const res3 = tracker.update(
    [{ id: 'agy:2', source: 'antigravity', title: 'Task B', status: 'waiting', detailStatus: 'RUN_STATE_IDLE', updatedAt: 6000 }],
    40000
  );
  assert.equal(res3.recentFinished.length, 0);
});

test('CodexMonitor and AntigravityMonitor poll without throwing', async () => {
  const codex = new CodexMonitor();
  const codexRes = codex.poll();
  assert.equal(typeof codexRes, 'object');
  assert.ok(Array.isArray(codexRes.items));

  const agy = new AntigravityMonitor();
  const agyRes = await agy.poll();
  assert.equal(typeof agyRes, 'object');
  assert.ok(Array.isArray(agyRes.items));
});

test('StateTracker dismisses thread and un-dismisses if it runs again', () => {
  const tracker = new StateTracker();
  tracker.update([
    { id: 'codex:1', source: 'codex', title: 'Task A', status: 'waiting', detailStatus: 'completed', updatedAt: 1000 },
  ], 2000);

  tracker.dismiss('codex:1');
  const afterDismiss = tracker.update([
    { id: 'codex:1', source: 'codex', title: 'Task A', status: 'waiting', detailStatus: 'completed', updatedAt: 1000 },
  ], 3000);
  assert.equal(afterDismiss.waiting.length, 0);

  const whenRunningAgain = tracker.update([
    { id: 'codex:1', source: 'codex', title: 'Task A', status: 'running', detailStatus: 'inProgress', updatedAt: 4000 },
  ], 5000);
  assert.equal(whenRunningAgain.running.length, 1);
});
