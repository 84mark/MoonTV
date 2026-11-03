import {
  deletePlayRecord,
  getAllPlayRecords,
  PlayRecord,
  savePlayRecord,
} from './db.client';
import { findPlayRecord, mergePlayRecords } from './play-records';

const record: PlayRecord = {
  title: '玉簟秋',
  year: '2026',
  source_name: 'A',
  cover: '',
  index: 13,
  total_episodes: 24,
  play_time: 123,
  total_time: 2400,
  save_time: 100,
};
beforeEach(() => localStorage.clear());
it('merges old source-specific records on read and persists the newest complete record', async () => {
  const newest = {
    ...record,
    source_name: 'B',
    index: 12,
    play_time: 20,
    save_time: 200,
  };
  localStorage.setItem(
    'moontv_play_records',
    JSON.stringify({ 'a+1': record, 'b+2': newest })
  );
  expect(await getAllPlayRecords()).toEqual({ 'b+2': newest });
  expect(
    JSON.parse(localStorage.getItem('moontv_play_records') || '{}')
  ).toEqual({ 'b+2': newest });
  // Rewatching an earlier episode must take precedence over the furthest progress.
  expect(findPlayRecord({ 'a+1': record, 'b+2': newest }, record)).toEqual(
    newest
  );
});
it('keeps one record after switching sources and emits the merged data', async () => {
  await savePlayRecord('a', '1', record);
  const listener = jest.fn();
  window.addEventListener('playRecordsUpdated', listener);
  const newest = { ...record, source_name: 'B', save_time: 200 };
  await savePlayRecord('b', '2', newest);
  expect(await getAllPlayRecords()).toEqual({ 'b+2': newest });
  expect(listener.mock.calls[0][0].detail).toEqual({ 'b+2': newest });
  window.removeEventListener('playRecordsUpdated', listener);
  await deletePlayRecord('b', '2');
  expect(await getAllPlayRecords()).toEqual({});
});
it('normalizes title spacing and retains different years, movies and seasons', () => {
  const records = {
    'a+1': record,
    'b+1': { ...record, title: ' 玉 簟 秋 ', save_time: 200 },
    'c+1': { ...record, year: '2025' },
    'd+1': { ...record, total_episodes: 1 },
    'e+1': { ...record, title: '玉簟秋 第二季' },
  };
  expect(Object.keys(mergePlayRecords(records))).toEqual([
    'b+1',
    'c+1',
    'd+1',
    'e+1',
  ]);
});
it('keeps both latest writes when different films save concurrently', async () => {
  await Promise.all([
    savePlayRecord('a', '1', record),
    savePlayRecord('b', '2', { ...record, title: '另一部影片' }),
  ]);
  expect(Object.keys(await getAllPlayRecords())).toHaveLength(2);
});
