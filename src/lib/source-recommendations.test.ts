import {
  ANIMATION_SOURCE_CANDIDATES,
  missingAnimationSources,
} from './source-recommendations';

it('does not duplicate an existing provider or change its disabled state', () => {
  const existing = {
    ...ANIMATION_SOURCE_CANDIDATES[0].source,
    key: 'user-subo',
    api: 'https://subocaiji.com/api.php/provide/vod',
    disabled: true,
  };
  const candidates = missingAnimationSources([existing]);
  expect(candidates).toHaveLength(2);
  expect(candidates.every((source) => source.disabled)).toBe(true);
  expect(existing.disabled).toBe(true);
});
