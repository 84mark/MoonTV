/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { speedKBps } from '@/lib/source-selection';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';
import type { VideoProbeResult } from '@/lib/video-probe';

// 定义视频信息类型
interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean; // 添加错误状态标识
  status?: VideoProbeResult['status'];
  latencyKind?: VideoProbeResult['latencyKind'];
  message?: string;
}

function mergeVideoInfo(current: VideoInfo | undefined, incoming: VideoInfo): VideoInfo {
  const live = incoming.message === '当前播放器已确认可播放'
    ? incoming : current?.message === '当前播放器已确认可播放' ? current : null;
  if (!live || !current) return incoming;
  const timing = incoming.pingTime > 0 ? incoming : current;
  return {
    ...incoming,
    quality: live.quality !== '未知' ? live.quality : incoming.quality,
    status: 'playable',
    message: live.message,
    loadSpeed: !['未知', '未测得'].includes(incoming.loadSpeed) ? incoming.loadSpeed : current.loadSpeed,
    pingTime: timing.pingTime,
    latencyKind: timing.latencyKind,
  };
}

interface EpisodeSelectorProps {
  /** 总集数 */
  totalEpisodes: number;
  /** 每页显示多少集，默认 50 */
  episodesPerPage?: number;
  /** 当前选中的集数（1 开始） */
  value?: number;
  /** 用户点击选集后的回调 */
  onChange?: (episodeNumber: number) => void;
  /** 换源相关 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 预计算的测速结果，避免重复测速 */
  precomputedVideoInfo?: Map<string, VideoInfo>;
  onAllSourcesUnavailable?: () => void;
}

/**
 * 选集组件，支持分页、自动滚动聚焦当前分页标签，以及换源功能。
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
  onAllSourcesUnavailable,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // 存储每个源的视频信息
  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map()
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );

  const [completedSources, setCompletedSources] = useState<Set<string>>(new Set());

  // 使用 ref 来避免闭包问题
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  // 同步状态到 ref
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  // 主要的 tab 状态：'episodes' 或 'sources'
  // 当只有一集时默认展示 "换源"，并隐藏 "选集" 标签
  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources'
  );

  // 当前分页索引（0 开始）
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // 是否倒序显示
  const [descending, setDescending] = useState<boolean>(false);

  // 根据 descending 状态计算实际显示的分页索引
  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  // 获取视频信息的函数 - 移除 attemptedSources 依赖避免不必要的重新创建
  const getVideoInfo = useCallback(async (source: SearchResult, force = false) => {
    const sourceKey = `${source.source}-${source.id}`;

    // 使用 ref 获取最新的状态，避免闭包问题
    if (!force && attemptedSourcesRef.current.has(sourceKey)) {
      return;
    }

    const episodeUrl = source.episodes?.[0];
    setCompletedSources((previous) => { const next = new Set(previous); next.delete(sourceKey); return next; });

    // 标记为已尝试
    setAttemptedSources((prev) => new Set(prev).add(sourceKey));
    attemptedSourcesRef.current.add(sourceKey);

    try {
      if (!episodeUrl) throw new Error('Missing playlist');
      const info = await getVideoResolutionFromM3u8(episodeUrl, { force });
      setVideoInfoMap((prev) => {
        const current = prev.get(sourceKey);
        return new Map(prev).set(sourceKey, mergeVideoInfo(current, info));
      });
    } catch (error) {
      // 失败时保存错误状态
      setVideoInfoMap((prev) =>
        new Map(prev).set(sourceKey, {
          quality: '未知',
          loadSpeed: '未测得',
          pingTime: 0,
          status: 'unknown',
          message: '预检未完成，可直接尝试播放',
        })
      );
    } finally {
      setCompletedSources((previous) => new Set(previous).add(sourceKey));
    }
  }, []);

  const previousPrecomputed = useRef<Map<string, VideoInfo>>(new Map());

  // 当有预计算结果时，先合并到videoInfoMap中
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      const updates = new Map(Array.from(precomputedVideoInfo).filter(([key, info]) => previousPrecomputed.current.get(key) !== info));
      previousPrecomputed.current = new Map(precomputedVideoInfo);
      // Do not replay stale measurements when a different background probe completes.
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        updates.forEach((value, key) => {
          newMap.set(key, mergeVideoInfo(newMap.get(key), value));
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        updates.forEach((info, key) => {
          if (info.message !== '当前播放器已确认可播放' || speedKBps(info.loadSpeed) > 0) {
            newSet.add(key);
          }
        });
        return newSet;
      });

      setCompletedSources((previous) => {
        const next = new Set(previous);
        updates.forEach((info, key) => {
          if (info.message !== '当前播放器已确认可播放' || speedKBps(info.loadSpeed) > 0) next.add(key);
        });
        return next;
      });

      // 同步更新 ref，确保 getVideoInfo 能立即看到更新
      updates.forEach((info, key) => {
        if (info.message !== '当前播放器已确认可播放' || speedKBps(info.loadSpeed) > 0) {
          attemptedSourcesRef.current.add(key);
        }
      });
    }
  }, [precomputedVideoInfo]);

  // 读取本地“优选和测速”开关，默认开启
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 当切换到换源tab并且有源数据时，异步获取视频信息 - 移除 attemptedSources 依赖避免循环触发
  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (
        !optimizationEnabled || // 若关闭测速则直接退出
        availableSources.length === 0
      )
        return;

      // 筛选出尚未测速的播放源
      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        return !attemptedSourcesRef.current.has(sourceKey);
      });

      if (pendingSources.length === 0) return;

      // The shared probe queue limits concurrency to three without waiting for a whole batch.
      await Promise.all(pendingSources.map((source) => getVideoInfo(source)));
    };

    fetchVideoInfosInBatches();
    // 依赖项保持与之前一致
  }, [activeTab, availableSources, getVideoInfo, optimizationEnabled]);

  const checksComplete = optimizationEnabled && availableSources.length > 0 && availableSources.every((source) => completedSources.has(`${source.source}-${source.id}`));
  const visibleSources = [...availableSources]
    .filter((source) => !checksComplete || speedKBps(videoInfoMap.get(`${source.source}-${source.id}`)?.loadSpeed) > 0)
    .sort((a, b) => speedKBps(videoInfoMap.get(`${b.source}-${b.id}`)?.loadSpeed) - speedKBps(videoInfoMap.get(`${a.source}-${a.id}`)?.loadSpeed));

  useEffect(() => {
    if (checksComplete && visibleSources.length === 0) onAllSourcesUnavailable?.();
  }, [checksComplete, visibleSources.length, onAllSourcesUnavailable]);

  // 升序分页标签
  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  // 根据 descending 状态决定分页标签的排序和内容
  const categories = useMemo(() => {
    if (descending) {
      // 倒序时，label 也倒序显示
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 当分页切换时，将激活的分页标签滚动到视口中间
  useEffect(() => {
    const btn = buttonRefs.current[displayPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      // 手动计算滚动位置，只滚动分页标签容器
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;

      // 计算按钮相对于容器的位置
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;

      // 计算目标滚动位置，使按钮居中
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;

      // 平滑滚动到目标位置
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [displayPage, pageCount]);

  // 处理换源tab点击，只在点击时才搜索
  const handleSourceTabClick = () => {
    setActiveTab('sources');
  };

  const handleCategoryClick = useCallback(
    (index: number) => {
      if (descending) {
        // 在倒序时，需要将显示索引转换为实际索引
        setCurrentPage(pageCount - 1 - index);
      } else {
        setCurrentPage(index);
      }
    },
    [descending, pageCount]
  );

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      onChange?.(episodeNumber);
    },
    [onChange]
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange]
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes
  );

  return (
    <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
      {/* 主要的 Tab 切换 - 无缝融入设计 */}
      <div className='flex mb-1 -mx-6 flex-shrink-0'>
        {totalEpisodes > 1 && (
          <div
            onClick={() => setActiveTab('episodes')}
            className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
              ${
                activeTab === 'episodes'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
              }
            `.trim()}
          >
            选集
          </div>
        )}
        <div
          onClick={handleSourceTabClick}
          className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
            ${
              activeTab === 'sources'
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
            }
          `.trim()}
        >
          换源
        </div>
      </div>

      {/* 选集 Tab 内容 */}
      {activeTab === 'episodes' && (
        <>
          {/* 分类标签 */}
          <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 flex-shrink-0'>
            <div className='flex-1 overflow-x-auto' ref={categoryContainerRef}>
              <div className='flex gap-2 min-w-max'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`w-20 relative py-2 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 text-center 
                        ${
                          isActive
                            ? 'text-green-500 dark:text-green-400'
                            : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                        }
                      `.trim()}
                    >
                      {label}
                      {isActive && (
                        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 向上/向下按钮 */}
            <button
              className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
              onClick={() => {
                // 切换集数排序（正序/倒序）
                setDescending((prev) => !prev);
              }}
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
          </div>

          {/* 集数网格 */}
          <div className='grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] auto-rows-[40px] gap-x-3 gap-y-3 overflow-y-auto h-full pb-4'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              const episodes = Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i
              );
              return episodes;
            })().map((episodeNumber) => {
              const isActive = episodeNumber === value;
              return (
                <button
                  key={episodeNumber}
                  onClick={() => handleEpisodeClick(episodeNumber - 1)}
                  className={`h-10 flex items-center justify-center text-sm font-medium rounded-md transition-all duration-200 
                    ${
                      isActive
                        ? 'bg-green-500 text-white shadow-lg shadow-green-500/25 dark:bg-green-600'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:scale-105 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
                    }`.trim()}
                >
                  {episodeNumber}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 换源 Tab 内容 */}
      {activeTab === 'sources' && (
        <div className='flex flex-col h-full mt-4'>
          <div className='mb-3 flex items-center justify-between gap-2 text-xs text-gray-500'>
            <span>{checksComplete ? '首集采样 · 按速度从快到慢排序' : optimizationEnabled ? '首集采样 · 检测完成后隐藏无速度的源' : '测速已关闭'}</span>
            <button disabled={optimizationEnabled && !checksComplete} className='shrink-0 text-green-600 disabled:opacity-40' onClick={() => { setVideoInfoMap(new Map()); setCompletedSources(new Set()); void Promise.all(availableSources.map(source => getVideoInfo(source, true))); }}>重新检测</button>
          </div>
          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
              <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                搜索中...
              </span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-red-500 text-2xl mb-2'>⚠️</div>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  {sourceSearchError}
                </p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center py-8'>
                <div className='text-center'>
                  <div className='text-gray-400 text-2xl mb-2'>📺</div>
                  <p className='text-sm text-gray-600 dark:text-gray-300'>
                    暂无可用的换源
                  </p>
                </div>
              </div>
            )}

          {checksComplete && visibleSources.length === 0 && <p role='status' className='py-8 text-center text-sm text-gray-500'>当前所有源均不可用</p>}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                {visibleSources
                  .map((source) => {
                    const sourceKey = `${source.source}-${source.id}`;
                    const info = videoInfoMap.get(sourceKey);
                    const isCurrentSource = source.source?.toString() === currentSource?.toString() && source.id?.toString() === currentId?.toString();
                    const status = info?.status === 'playable' ? '播放已确认' : info?.status === 'reachable' ? '接口可达' : info ? '预检未确认' : optimizationEnabled ? '检测中…' : '未检测';
                    return (
                      <button
                        type='button'
                        key={sourceKey}
                        aria-pressed={isCurrentSource}
                        aria-label={`${isCurrentSource ? '当前源' : '切换到'} ${source.source_name}`}
                        title={info?.message || '点击切换播放源'}
                        onClick={() => !isCurrentSource && handleSourceClick(source)}
                        className={`grid w-full grid-cols-2 items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-left transition-colors ${isCurrentSource ? 'border-green-500 bg-green-500/10 dark:bg-green-500/20' : 'border-gray-200 hover:border-green-500/60 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-white/5'}`}
                      >
                        <span className='col-span-2 min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {source.source_name}{isCurrentSource && <span className='ml-2 text-xs text-green-600 dark:text-green-400'>当前</span>}
                        </span>
                        <span className={`col-span-2 text-xs ${info?.status === 'playable' ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                          {info?.quality && info.quality !== '未知' ? `${info.quality} · ` : ''}{status}
                        </span>
                        <span className='whitespace-nowrap text-[11px] text-gray-500'>速度 {info?.loadSpeed || '未测得'}</span>
                        <span className='whitespace-nowrap text-right text-[11px] text-gray-500'>
                          {info && info.pingTime > 0 ? `${info.latencyKind === 'metadata' ? '准备' : '响应'} ${info.pingTime} ms` : '响应未测得'}
                        </span>
                      </button>
                    );
                  })}
                <div className='flex-shrink-0 mt-auto pt-2 border-t border-gray-400 dark:border-gray-700'>
                  <button
                    onClick={() => {
                      if (videoTitle) {
                        router.push(
                          `/search?q=${encodeURIComponent(videoTitle)}`
                        );
                      }
                    }}
                    className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
                  >
                    影片匹配有误？点击去搜索
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
