import { beforeEach, describe, expect, it, vi } from 'vitest';

const tasksFindMany = vi.hoisted(() => vi.fn());
const usersFindMany = vi.hoisted(() => vi.fn());
const contestsFindMany = vi.hoisted(() => vi.fn());
const teamsFindMany = vi.hoisted(() => vi.fn());
const adminsFindMany = vi.hoisted(() => vi.fn());
const announcementsFindMany = vi.hoisted(() => vi.fn());
const attachmentsFindMany = vi.hoisted(() => vi.fn());
const datasetsFindMany = vi.hoisted(() => vi.fn());
const testcasesFindMany = vi.hoisted(() => vi.fn());
const groupsFindMany = vi.hoisted(() => vi.fn());
const messagesFindMany = vi.hoisted(() => vi.fn());
const questionsFindMany = vi.hoisted(() => vi.fn());
const managersFindMany = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contests: { findMany: contestsFindMany },
    tasks: { findMany: tasksFindMany },
    users: { findMany: usersFindMany },
    teams: { findMany: teamsFindMany },
    admins: { findMany: adminsFindMany },
    announcements: { findMany: announcementsFindMany },
    attachments: { findMany: attachmentsFindMany },
    datasets: { findMany: datasetsFindMany },
    testcases: { findMany: testcasesFindMany },
    groups: { findMany: groupsFindMany },
    messages: { findMany: messagesFindMany },
    questions: { findMany: questionsFindMany },
    managers: { findMany: managersFindMany },
  },
}));

import { entityNameKey, loadEntityNames } from '@/lib/entity-names';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadEntityNames', () => {
  it('batches same-type refs into one query and formats task labels', async () => {
    tasksFindMany.mockResolvedValue([
      { id: 12, title: 'Practice Round', name: 'practice' },
      { id: 13, title: 'A', name: 'A' },
    ]);
    contestsFindMany.mockResolvedValue([{ id: 5, name: 'Midterm' }]);

    const names = await loadEntityNames([
      { entity: 'task', entity_id: '12' },
      { entity: 'task', entity_id: '13' },
      { entity: 'contest', entity_id: '5' },
    ]);

    expect(tasksFindMany).toHaveBeenCalledTimes(1);
    expect(tasksFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [12, 13] } } }),
    );
    expect(contestsFindMany).toHaveBeenCalledTimes(1);
    expect(names.get(entityNameKey('task', '12'))).toBe('Practice Round (practice)');
    expect(names.get(entityNameKey('task', '13'))).toBe('A');
    expect(names.get(entityNameKey('contest', '5'))).toBe('Midterm');
  });

  it('skips null ids, non-numeric ids, and unmapped entities', async () => {
    groupsFindMany.mockResolvedValue([{ id: 7, name: 'Team X' }]);

    const names = await loadEntityNames([
      { entity: 'task', entity_id: null },
      { entity: 'task', entity_id: 'nope' },
      { entity: 'statement', entity_id: '9' },
      { entity: 'group', entity_id: '7' },
    ]);

    expect(groupsFindMany).toHaveBeenCalledTimes(1);
    expect(tasksFindMany).not.toHaveBeenCalled();
    expect(names.get(entityNameKey('group', '7'))).toBe('Team X');
    expect(names.has(entityNameKey('statement', '9'))).toBe(false);
  });

  it('formats user labels as full name (username)', async () => {
    usersFindMany.mockResolvedValue([
      { id: 4, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' },
    ]);

    const names = await loadEntityNames([{ entity: 'user', entity_id: '4' }]);

    expect(names.get(entityNameKey('user', '4'))).toBe('Ada Lovelace (ada)');
  });

  it('falls back to username for admins with an empty name', async () => {
    adminsFindMany.mockResolvedValue([{ id: 2, name: '', username: 'root' }]);

    const names = await loadEntityNames([{ entity: 'admin', entity_id: '2' }]);

    expect(names.get(entityNameKey('admin', '2'))).toBe('root');
  });

  it('resolves labels for the remaining mapped entity types', async () => {
    teamsFindMany.mockResolvedValue([{ id: 1, name: 'Team A' }]);
    announcementsFindMany.mockResolvedValue([{ id: 2, subject: 'Schedule' }]);
    attachmentsFindMany.mockResolvedValue([{ id: 3, filename: 'guide.pdf' }]);
    datasetsFindMany.mockResolvedValue([{ id: 4, description: 'Sample set' }]);
    testcasesFindMany.mockResolvedValue([{ id: 5, codename: 'tc01' }]);
    messagesFindMany.mockResolvedValue([{ id: 6, subject: 'Hello' }]);
    questionsFindMany.mockResolvedValue([{ id: 7, subject: 'Clarify' }]);
    managersFindMany.mockResolvedValue([{ id: 8, filename: 'cms' }]);
    contestsFindMany.mockResolvedValue([{ id: 9, name: 'Final' }]);

    const names = await loadEntityNames([
      { entity: 'team', entity_id: '1' },
      { entity: 'announcement', entity_id: '2' },
      { entity: 'attachment', entity_id: '3' },
      { entity: 'dataset', entity_id: '4' },
      { entity: 'testcase', entity_id: '5' },
      { entity: 'message', entity_id: '6' },
      { entity: 'question', entity_id: '7' },
      { entity: 'manager', entity_id: '8' },
      { entity: 'deployment', entity_id: '9' },
    ]);

    expect(names.get(entityNameKey('team', '1'))).toBe('Team A');
    expect(names.get(entityNameKey('announcement', '2'))).toBe('Schedule');
    expect(names.get(entityNameKey('attachment', '3'))).toBe('guide.pdf');
    expect(names.get(entityNameKey('dataset', '4'))).toBe('Sample set');
    expect(names.get(entityNameKey('testcase', '5'))).toBe('tc01');
    expect(names.get(entityNameKey('message', '6'))).toBe('Hello');
    expect(names.get(entityNameKey('question', '7'))).toBe('Clarify');
    expect(names.get(entityNameKey('manager', '8'))).toBe('cms');
    expect(names.get(entityNameKey('deployment', '9'))).toBe('Final');
  });

  it('leaves no key when the referenced row is gone', async () => {
    tasksFindMany.mockResolvedValue([]);

    const names = await loadEntityNames([{ entity: 'task', entity_id: '99' }]);

    expect(names.has(entityNameKey('task', '99'))).toBe(false);
  });
});