// Throwaway verification: exercises the real confirmation builders and toast copy for both locales.
import assert from 'node:assert/strict';

import enRaw from '@/dictionaries/en.json';
import thRaw from '@/dictionaries/th.json';
import { buildConfirmationCopy } from '@/lib/confirmation-copy';
import { interpolate } from '@/lib/interpolate';

const en = buildConfirmationCopy(enRaw.confirmations);
const th = buildConfirmationCopy(thRaw.confirmations);

// Every string below is the literal that was hardcoded in confirmation-copy.ts before this change.
const englishExpectations: Array<[string, { title: string; description: string; confirmLabel: string }]> = [
  ['destructive(team)', en.destructiveConfirm('team')],
];
void englishExpectations;

const cases: Array<[string, { kind: string; title: string; description: string; confirmLabel: string }]> = [
  ['destructiveConfirm(team)', en.destructiveConfirm('team')],
  ['destructiveConfirm(managerFile)', en.destructiveConfirm('managerFile')],
  ['destroy, kind kept', en.destructiveConfirm('user')],
  ['removeParticipantConfirm', en.removeParticipantConfirm()],
  ['removeTaskFromContestConfirm', en.removeTaskFromContestConfirm()],
  ['markTestUserConfirm', en.markTestUserConfirm()],
  ['recalculateSubmissionConfirm(score)', en.recalculateSubmissionConfirm('score')],
  ['recalculateSubmissionConfirm(full)', en.recalculateSubmissionConfirm('full')],
  ['fullServerUpdateConfirm', en.fullServerUpdateConfirm()],
  ['restartStackConfirm(core)', en.restartStackConfirm('core')],
  ['restartStackConfirm(all)', en.restartStackConfirm('all')],
  ['pullImagesConfirm', en.pullImagesConfirm()],
  ['rebuildStackConfirm(core)', en.rebuildStackConfirm('core')],
  ['rebuildStackConfirm(all)', en.rebuildStackConfirm('all')],
  ['manualBackupConfirm', en.manualBackupConfirm()],
];

const before = new Map([
  ['destructiveConfirm(team)', { kind: 'destructive', title: 'Delete this team?', description: 'This permanently deletes the team. This cannot be undone.', confirmLabel: 'Delete team' }],
  ['destructiveConfirm(managerFile)', { kind: 'destructive', title: 'Delete this manager file?', description: 'This permanently deletes the manager file. This cannot be undone.', confirmLabel: 'Delete manager file' }],
  ['destroy, kind kept', { kind: 'destructive', title: 'Delete this user?', description: 'This permanently deletes the user. This cannot be undone.', confirmLabel: 'Delete user' }],
  ['removeParticipantConfirm', { kind: 'destructive', title: 'Remove this participant?', description: "This permanently removes the participant's entry from this contest. This cannot be undone.", confirmLabel: 'Remove participant' }],
  ['removeTaskFromContestConfirm', { kind: 'recoverable', title: 'Remove this task from the contest?', description: 'The task is unassigned and is not deleted; it can be added to the contest again.', confirmLabel: 'Remove task' }],
  ['markTestUserConfirm', { kind: 'recoverable', title: 'Mark this user as a test user?', description: 'The participant becomes hidden and unrestricted. Both flags can be changed back in the participation settings.', confirmLabel: 'Mark as test user' }],
  ['recalculateSubmissionConfirm(score)', { kind: 'operational', title: 'Recalculate this submission (score)?', description: 'Current results are cleared and recomputed from the submission, which is kept.', confirmLabel: 'Recalculate' }],
  ['recalculateSubmissionConfirm(full)', { kind: 'operational', title: 'Recalculate this submission (full)?', description: 'Current results are cleared and recomputed from the submission, which is kept.', confirmLabel: 'Recalculate' }],
  ['fullServerUpdateConfirm', { kind: 'operational', title: 'Run a full server update?', description: 'This pulls the latest images, restarts all services and updates the database schema. The server is unavailable for a few minutes.', confirmLabel: 'Run update' }],
  ['restartStackConfirm(core)', { kind: 'operational', title: 'Restart Core Stack?', description: 'The affected services restart and are unavailable until they come back up.', confirmLabel: 'Restart' }],
  ['restartStackConfirm(all)', { kind: 'operational', title: 'Restart All Services?', description: 'The affected services restart and are unavailable until they come back up.', confirmLabel: 'Restart' }],
  ['pullImagesConfirm', { kind: 'operational', title: 'Pull the latest images?', description: 'Images are downloaded from the registry without restarting the running services. This may take several minutes.', confirmLabel: 'Pull images' }],
  ['rebuildStackConfirm(core)', { kind: 'operational', title: 'Rebuild Core images from source?', description: 'Images are rebuilt from the current source without restarting the running services. This may take 5-10 minutes.', confirmLabel: 'Rebuild images' }],
  ['rebuildStackConfirm(all)', { kind: 'operational', title: 'Rebuild All images from source?', description: 'Images are rebuilt from the current source without restarting the running services. This may take 5-10 minutes.', confirmLabel: 'Rebuild images' }],
  ['manualBackupConfirm', { kind: 'operational', title: 'Trigger a manual backup now?', description: 'All submissions are backed up in the background; the server keeps running.', confirmLabel: 'Trigger backup' }],
]);

for (const [name, actual] of cases) {
  assert.deepStrictEqual(actual, before.get(name), `English copy changed for ${name}`);
}
console.log(`English confirmation copy identical to pre-change literals   : ${cases.length}/${cases.length} PASS`);

// Toast copy: the English rendering must also be the previous literal.
const toastCases: Array<[string, string, string]> = [
  ['toasts.envConfig.saveFailed', interpolate(enRaw.toasts.envConfig.saveFailed, { filename: 'config.toml', error: 'EACCES' }), 'Failed to save config.toml: EACCES'],
  ['toasts.envConfig.restarted', interpolate(enRaw.toasts.envConfig.restarted, { services: 'monitor' }), 'Saved and restarted: monitor'],
  ['toasts.envConfig.saved', interpolate(enRaw.toasts.envConfig.saved, { filename: '.env' }), 'Saved .env successfully!'],
  ['toasts.deploy.progressMessage', interpolate(enRaw.toasts.deploy.progressMessage, { contestId: 5, percent: 42 }), 'Deploying contest #5 — 42% pulling'],
  ['toasts.deploy.completedDescription', interpolate(enRaw.toasts.deploy.completedDescription, { contestId: 5 }), 'Contest #5 is now active.'],
  ['toasts.maintenance.testAlertDelivered', interpolate(enRaw.toasts.maintenance.testAlertDelivered, { status: 204 }), 'Test alert delivered (HTTP 204).'],
  ['toasts.monitor.resultDescription', interpolate(enRaw.toasts.monitor.resultDescription, { status: 200, expectedStatus: 200, latency: 12 }), 'HTTP 200 (expected 200) — 12ms'],
  ['toasts.discord.envWriteFailed', interpolate(enRaw.toasts.discord.envWriteFailed, { configToml: 'config.toml', envFile: '.env', error: 'boom' }), 'config.toml was updated, but writing .env failed: boom'],
  ['toasts.serviceControl.actionFailed', interpolate(enRaw.toasts.serviceControl.actionFailed, { error: 'boom' }), 'Error: boom'],
];
for (const [key, actual, expected] of toastCases) {
  assert.equal(actual, expected, `English toast copy changed for ${key}`);
}
console.log(`English toast copy identical to pre-change literals          : ${toastCases.length}/${toastCases.length} PASS`);

// Thai: the same builders, with the Thai dictionary.
console.log('\n--- Thai locale, real builder output ---');
console.log('destructiveConfirm("team")    :', JSON.stringify(th.destructiveConfirm('team')));
console.log('destructiveConfirm("managerFile"):', JSON.stringify(th.destructiveConfirm('managerFile')));
console.log('manualBackupConfirm()         :', JSON.stringify(th.manualBackupConfirm()));
console.log('restartStackConfirm("core")   :', JSON.stringify(th.restartStackConfirm('core')));
console.log('recalculateSubmissionConfirm("score"):', JSON.stringify(th.recalculateSubmissionConfirm('score')));
console.log('captions/cancel               :', JSON.stringify({
  cancel: thRaw.confirmations.cancel,
  captions: thRaw.confirmations.captions,
}));
console.log('toast toasts.maintenance.saveFailed   :', JSON.stringify(interpolate(thRaw.toasts.maintenance.saveFailed, { error: 'EACCES' })));
console.log('toast toasts.envConfig.restarted      :', JSON.stringify(interpolate(thRaw.toasts.envConfig.restarted, { services: 'monitor' })));
console.log('toast toasts.deploy.progressMessage   :', JSON.stringify(interpolate(thRaw.toasts.deploy.progressMessage, { contestId: 5, percent: 42 })));

assert.deepStrictEqual(th.destructiveConfirm('team'), {
  kind: 'destructive',
  title: 'ลบทีมนี้หรือไม่?',
  description: 'การดำเนินการนี้จะลบทีมอย่างถาวร ไม่สามารถย้อนกลับได้',
  confirmLabel: 'ลบทีม',
});
assert.deepStrictEqual(th.manualBackupConfirm(), {
  kind: 'operational',
  title: 'เริ่มสำรองข้อมูลด้วยตนเองตอนนี้หรือไม่?',
  description: 'การส่งคำตอบทั้งหมดจะถูกสำรองข้อมูลอยู่เบื้องหลัง เซิร์ฟเวอร์ยังคงทำงานต่อ',
  confirmLabel: 'เริ่มสำรองข้อมูล',
});
assert.equal(interpolate(thRaw.toasts.maintenance.saveFailed, { error: 'EACCES' }), 'บันทึกไม่สำเร็จ: EACCES');
assert.ok(!/[\u0E00-\u0E7F]/.test(en.destructiveConfirm('team').title), 'English title must stay English');
console.log('\nThai assertions PASS (Thai text reaches title/description/confirmLabel and toast messages).');
