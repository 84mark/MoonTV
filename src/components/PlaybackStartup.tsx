'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface StartupStep {
  label: string;
  at: number;
}

export function usePlaybackStartup() {
  const origin = useRef<number | null>(null);
  const [steps, setSteps] = useState<StartupStep[]>([]);
  const mark = useCallback((label: string) => {
    const now = performance.now();
    if (origin.current === null) origin.current = now;
    const at = now - origin.current;
    setSteps((previous) => {
      if (previous.some((step) => step.label === label)) return previous;
      if (previous.some((step) => step.label === '画面已播放')) return previous;
      return [...previous, { label, at }];
    });
  }, []);
  return { steps, mark };
}

export default function PlaybackStartup({ steps }: { steps: StartupStep[] }) {
  const [elapsed, setElapsed] = useState(0);
  const finished = steps[steps.length - 1]?.label === '画面已播放';
  useEffect(() => {
    if (finished) return;
    const started = performance.now();
    const initial = steps[steps.length - 1]?.at || 0;
    setElapsed(initial);
    const timer = setInterval(
      () => setElapsed(initial + performance.now() - started),
      200
    );
    return () => clearInterval(timer);
  }, [steps, finished]);
  if (!steps.length) return null;
  const total = finished ? steps[steps.length - 1].at : elapsed;
  return (
    <details
      className='rounded-xl bg-gray-100/80 px-4 py-3 text-xs text-gray-600 dark:bg-gray-800/80 dark:text-gray-300'
      open={!finished}
    >
      <summary className='cursor-pointer font-medium' aria-live='polite'>
        {finished ? '开始播放耗时' : steps[steps.length - 1].label}
        {' · '}
        {(total / 1000).toFixed(1)} 秒
      </summary>
      <ol className='mt-3 space-y-2'>
        {steps.map((step, index) => (
          <li key={step.label} className='flex justify-between gap-4'>
            <span>{step.label}</span>
            <span className='tabular-nums'>
              {index < steps.length - 1
                ? `${((steps[index + 1].at - step.at) / 1000).toFixed(1)} 秒`
                : finished
                ? '完成'
                : '进行中'}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
