/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { Heart } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  rememberEpisode,
  requestedEpisode,
  storedEpisode,
} from '@/lib/episode-progress';
import { kidsLanguage, kidsPlaybackMatches } from '@/lib/kids-resources';
import { findPlayRecord } from '@/lib/play-records';
import { getPreparedPlayback } from '@/lib/playback-preload';
import { DownloadMeter } from '@/lib/playback-stats';
import { firstMeasuredSource } from '@/lib/source-selection';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';
import { qualityForWidth, VideoProbeResult } from '@/lib/video-probe';

import DoubanComments from '@/components/DoubanComments';
import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';
import { usePlaybackStartup } from '@/components/PlaybackStartup';
import PlaybackStats from '@/components/PlaybackStats';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startup = usePlaybackStartup();

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 跳过检查的时间间隔控制
  const lastSkipCheckRef = useRef(0);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(() =>
    requestedEpisode(new URLSearchParams(searchParams.toString()))
  );
  const [measuredEpisodeIndex, setMeasuredEpisodeIndex] =
    useState(currentEpisodeIndex);
  const downloadMeter = useRef(new DownloadMeter()).current;
  const [statsTarget, setStatsTarget] = useState<{
    container: HTMLElement;
    video: HTMLVideoElement;
  } | null>(null);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默认 1.0
  const lastPlaybackRateRef = useRef<number>(1.0);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选和测速开关
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

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, VideoProbeResult>
  >(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (error && artPlayerRef.current) {
      artPlayerRef.current.destroy();
      artPlayerRef.current = null;
    }
  }, [error]);

  const [playbackFailure, setPlaybackFailure] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [playbackRetry, setPlaybackRetry] = useState(0);
  const availableSourcesRef = useRef(availableSources);
  availableSourcesRef.current = availableSources;
  const attemptedSources = useRef(new Set<string>());
  const attemptedUrls = useRef(new Set<string>());
  const installedSourceKey = useRef('');
  const startedSources = useRef(new Set<string>());
  const playbackMounted = useRef(true);
  const sourceAttemptKey = () =>
    `${currentEpisodeIndexRef.current}:${currentSourceRef.current}:${currentIdRef.current}`;
  const reportPlaybackFailure = (expectedKey = installedSourceKey.current) => {
    if (!playbackMounted.current || expectedKey !== sourceAttemptKey()) return;
    attemptedSources.current.add(expectedKey);
    attemptedUrls.current.add(
      `${currentEpisodeIndexRef.current}:${
        detailRef.current?.episodes[currentEpisodeIndexRef.current] || ''
      }`
    );
    setPlaybackFailure(true);
  };
  useEffect(() => {
    playbackMounted.current = true;
    return () => {
      playbackMounted.current = false;
      artPlayerRef.current?.destroy();
      artPlayerRef.current = null;
    };
  }, []);
  useEffect(() => {
    setPlaybackFailure(false);
    setPlaybackError('');
    attemptedSources.current.clear();
    attemptedUrls.current.clear();
  }, [currentEpisodeIndex]);
  useEffect(() => {
    if (!playbackFailure) return;
    const index = currentEpisodeIndexRef.current;
    const next = availableSourcesRef.current.find(
      (source) =>
        source.episodes?.[index] &&
        kidsPlaybackMatches(searchParams, source) &&
        !attemptedSources.current.has(
          `${index}:${source.source}:${source.id}`
        ) &&
        !attemptedUrls.current.has(`${index}:${source.episodes[index]}`)
    );
    if (!next) {
      if (!sourceSearchLoading) {
        setIsVideoLoading(false);
        setPlaybackError('当前线路暂时无法播放，请更换片源或重试。');
      }
      return;
    }
    const time = artPlayerRef.current?.currentTime;
    if (Number.isFinite(time) && time > 0) resumeTimeRef.current = time;
    setPlaybackFailure(false);
    setPlaybackError('');
    setVideoLoadingStage('sourceChanging');
    setIsVideoLoading(true);
    currentSourceRef.current = next.source;
    currentIdRef.current = next.id;
    detailRef.current = next;
    setCurrentSource(next.source);
    setCurrentId(next.id);
    setVideoTitle(next.title);
    setVideoYear(next.year);
    setVideoCover(next.poster);
    setDetail(next);
    const url = new URL(window.location.href);
    url.searchParams.set('source', next.source);
    url.searchParams.set('id', next.id);
    window.history.replaceState(window.history.state, '', url.toString());
  }, [playbackFailure, availableSources, sourceSearchLoading]);
  useEffect(() => {
    if (loading || !videoUrl) return;
    const key = sourceAttemptKey();
    startedSources.current.delete(key);
    const timer = setTimeout(() => {
      if (!startedSources.current.has(key) && key === sourceAttemptKey())
        reportPlaybackFailure();
    }, 12000);
    return () => clearTimeout(timer);
  }, [loading, videoUrl, playbackRetry]);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[],
    active: () => boolean = () => true
  ): Promise<SearchResult | null> => {
    const index = currentEpisodeIndexRef.current;
    return firstMeasuredSource(
      sources,
      (url) => getVideoResolutionFromM3u8(url),
      (source, result) => {
        if (!active() || currentEpisodeIndexRef.current !== index) return;
        setMeasuredEpisodeIndex(index);
        setPrecomputedVideoInfo((previous) =>
          new Map(previous).set(`${source.source}-${source.id}`, result)
        );
      },
      index,
      true
    );
  };

  // 更新视频地址
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  // 去广告相关函数
  function filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 只过滤#EXT-X-DISCONTINUITY标识
      if (!line.includes('#EXT-X-DISCONTINUITY')) {
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        artPlayerRef.current.setting.update({
          name: '跳过片头片尾',
          html: '跳过片头片尾',
          switch: skipConfigRef.current.enable,
          onSwitch: function (item: any) {
            const newConfig = {
              ...skipConfigRef.current,
              enable: !item.switch,
            };
            handleSkipConfigChange(newConfig);
            return !item.switch;
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片头',
          html: '设置片头',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
          tooltip:
            skipConfigRef.current.intro_time === 0
              ? '设置片头时间'
              : `${formatTime(skipConfigRef.current.intro_time)}`,
          onClick: function () {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            if (currentTime > 0) {
              const newConfig = {
                ...skipConfigRef.current,
                intro_time: currentTime,
              };
              handleSkipConfigChange(newConfig);
              return `${formatTime(currentTime)}`;
            }
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片尾',
          html: '设置片尾',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
          tooltip:
            skipConfigRef.current.outro_time >= 0
              ? '设置片尾时间'
              : `-${formatTime(-skipConfigRef.current.outro_time)}`,
          onClick: function () {
            const outroTime =
              -(
                artPlayerRef.current?.duration -
                artPlayerRef.current?.currentTime
              ) || 0;
            if (outroTime < 0) {
              const newConfig = {
                ...skipConfigRef.current,
                outro_time: outroTime,
              };
              handleSkipConfigChange(newConfig);
              return `-${formatTime(-outroTime)}`;
            }
          },
        });
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
      console.log('跳过片头片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (hours === 0) {
      // 不到一小时，格式为 00:00
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      // 超过一小时，格式为 00:00:00
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 拦截manifest和level请求
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any
          ) {
            // 如果是m3u8文件，处理内容以移除广告分段
            if (response.data && typeof response.data === 'string') {
              // 过滤掉广告段 - 实现更精确的广告过滤逻辑
              response.data = filterAdsFromM3U8(response.data);
            }
            return onSuccess(response, stats, context, null);
          };
        }
        // 执行原始load方法
        load(context, config, callbacks);
      };
    }
  }

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // Start the selected source immediately; discovery and measurements never gate playback.
  useEffect(() => {
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    const validSource = (source: SearchResult) =>
      source &&
      typeof source.title === 'string' &&
      Array.isArray(source.episodes) &&
      source.episodes.length > 0 &&
      kidsPlaybackMatches(searchParams, source);
    const fetchSourceDetail = async (): Promise<SearchResult[]> => {
      try {
        const response = await fetch(
          `/api/detail?${new URLSearchParams({
            source: currentSource,
            id: currentId,
          })}`,
          { cache: 'no-store', signal: controller.signal }
        );
        if (!response.ok) return [];
        const source = await response.json();
        return validSource(source) ? [source] : [];
      } catch {
        return [];
      }
    };
    const fetchSourcesData = async (): Promise<SearchResult[]> => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(
            (searchTitle || videoTitle).trim()
          )}`,
          { cache: 'no-store', signal: controller.signal }
        );
        if (!response.ok) throw new Error('搜索失败');
        const data = await response.json();
        if (!Array.isArray(data.results)) throw new Error('搜索结果无效');
        return data.results.filter(
          (source: SearchResult) =>
            validSource(source) &&
            (searchParams.has('kids_id') ||
              source.title.replaceAll(' ', '').toLowerCase() ===
                videoTitle.replaceAll(' ', '').toLowerCase()) &&
            (!videoYear || source.year === videoYear) &&
            (!searchType ||
              (searchType === 'movie'
                ? source.episodes.length === 1
                : source.episodes.length > 1))
        );
      } catch (err) {
        if (active())
          setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        return [];
      }
    };
    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoadingMessage('正在加载视频…');
      startup.mark('读取观看记录');
      const historyRequest = getAllPlayRecords().catch(
        (): Awaited<ReturnType<typeof getAllPlayRecords>> => ({})
      );
      const prepared = getPreparedPlayback(searchParams.get('preload'));
      let sourcesInfo = prepared?.snapshot.sources.filter(validSource) || [];
      let discoverAfterStart = false;
      if (!sourcesInfo.length && currentSource && currentId) {
        sourcesInfo = await fetchSourceDetail();
        discoverAfterStart = sourcesInfo.length > 0;
      }
      if (!sourcesInfo.length) sourcesInfo = await fetchSourcesData();
      const records = await historyRequest;
      if (!active()) return;
      if (!sourcesInfo.length) {
        setError(
          searchParams.has('kids_id')
            ? '所选语言或季数暂无可用片源，请返回选择其他版本。'
            : '未找到匹配结果'
        );
        setLoading(false);
        return;
      }
      setAvailableSources(sourcesInfo);
      if (
        !searchParams.has('episode') &&
        storedEpisode(videoTitle, videoYear) === undefined
      ) {
        const legacy =
          findPlayRecord(records, {
            title: videoTitle || sourcesInfo[0].title,
            year: videoYear || sourcesInfo[0].year,
            total_episodes: sourcesInfo[0].episodes.length,
          }) || records[generateStorageKey(currentSource, currentId)];
        if (legacy && Number.isSafeInteger(legacy.index) && legacy.index > 0) {
          currentEpisodeIndexRef.current = legacy.index - 1;
          setCurrentEpisodeIndex(legacy.index - 1);
        }
      }
      if (prepared?.snapshot.episodeIndex === currentEpisodeIndexRef.current) {
        setPrecomputedVideoInfo(new Map(prepared.snapshot.results));
        setMeasuredEpisodeIndex(currentEpisodeIndexRef.current);
      }
      const detailData =
        sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        ) ||
        sourcesInfo.find(
          (source) => source.episodes[currentEpisodeIndexRef.current]
        ) ||
        sourcesInfo[0];
      const history = findPlayRecord(records, {
        title: detailData.title,
        year: detailData.year,
        total_episodes: detailData.episodes.length,
      });
      if (history?.index === currentEpisodeIndexRef.current + 1)
        resumeTimeRef.current = history.play_time;
      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitle);
      setVideoCover(detailData.poster);
      setDetail(detailData);
      if (currentEpisodeIndexRef.current >= detailData.episodes.length) {
        currentEpisodeIndexRef.current = 0;
        resumeTimeRef.current = null;
        setCurrentEpisodeIndex(0);
      }
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState(window.history.state, '', newUrl.toString());
      startup.mark('创建播放器');
      setLoadingStage('ready');
      setLoading(false);
      const shouldMeasure =
        optimizationEnabled &&
        (!currentSource || !currentId || needPreferRef.current);
      if (discoverAfterStart) {
        setSourceSearchLoading(true);
        void fetchSourcesData().then((results) => {
          if (!active()) return;
          const merged = [
            detailData,
            ...results.filter(
              (source) =>
                source.source !== detailData.source ||
                source.id !== detailData.id
            ),
          ];
          setAvailableSources(merged);
          setSourceSearchLoading(false);
          if (shouldMeasure) void preferBestSource(merged, active);
        });
      } else if (shouldMeasure) {
        void preferBestSource(sourcesInfo, active);
      }
    };
    void initAll();
    return () => controller.abort();
  }, []);

  // 跳过片头片尾配置处理
  useEffect(() => {
    // 仅在初次挂载时检查跳过片头片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        }
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };

    initSkipConfig();
  }, []);

  const sourceChangeVersion = useRef(0);
  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    const version = ++sourceChangeVersion.current;
    const requestedIndex = currentEpisodeIndexRef.current;
    try {
      setPlaybackFailure(false);
      setPlaybackError('');
      attemptedSources.current.delete(
        `${currentEpisodeIndexRef.current}:${newSource}:${newId}`
      );
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }

      // 清除并设置下一个跳过片头片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      if (
        !playbackMounted.current ||
        version !== sourceChangeVersion.current ||
        requestedIndex !== currentEpisodeIndexRef.current
      )
        return;
      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail || !kidsPlaybackMatches(searchParams, newDetail)) {
        setError(
          searchParams.has('kids_id')
            ? '所选语言或季数暂无可用片源，请返回选择其他版本。'
            : '未找到匹配结果'
        );
        return;
      }

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集数且播放进度有效，则在播放器就绪后恢复到原始进度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState(window.history.state, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      sourceChangeVersion.current++;
      setPlaybackFailure(false);
      setPlaybackError('');
      // 在更换集数前保存当前播放进度
      if (artPlayerRef.current) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  // 保存播放进度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    rememberEpisode(
      videoTitleRef.current,
      videoYearRef.current,
      currentEpisodeIndexRef.current
    );
    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
        ...(searchParams.get('kids_id') &&
        searchParams.get('kids_language') &&
        kidsPlaybackMatches(searchParams, detailRef.current)
          ? {
              kids_id: searchParams.get('kids_id') || undefined,
              kids_language: searchParams.get('kids_language') || undefined,
            }
          : {}),
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
    };

    // 页面可见性变化时保存播放进度
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
      void saveCurrentPlayProgress();
      artPlayerRef.current?.video?.hls?.destroy();
      artPlayerRef.current?.destroy();
      artPlayerRef.current = null;
      downloadMeter.reset();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  useEffect(() => {
    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    downloadMeter.reset();
    // 非WebKit浏览器且播放器已存在，使用switch方法切换
    if (!isWebkit && artPlayerRef.current) {
      installedSourceKey.current = sourceAttemptKey();
      artPlayerRef.current.switch = videoUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = videoCover;
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    if (artPlayerRef.current) {
      if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
        artPlayerRef.current.video.hls.destroy();
      }
      // 销毁播放器实例
      artPlayerRef.current.destroy();
      artPlayerRef.current = null;
    }

    try {
      // 创建新的播放器实例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = true;

      startup.mark('加载播放列表');
      installedSourceKey.current = sourceAttemptKey();
      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: '#3b82f6',
        lang: 'zh-cn',
        hotkey: false,
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
        },
        // HLS 支持配置
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string) {
            if (!Hls) {
              console.error('HLS.js 未加载');
              return;
            }

            if (video.hls) {
              video.hls.destroy();
            }
            if (
              !Hls.isSupported() &&
              video.canPlayType('application/vnd.apple.mpegurl')
            ) {
              video.src = url;
              return;
            }
            const hls = new Hls({
              debug: false, // 关闭日志
              enableWorker: true, // WebWorker 解码，降低主线程压力
              lowLatencyMode: true, // 开启低延迟 LL-HLS

              /* 缓冲/内存相关 */
              maxBufferLength: 30, // 前向缓冲最大 30s，过大容易导致高延迟
              backBufferLength: 30, // 仅保留 30s 已播放内容，避免内存占用
              maxBufferSize: 60 * 1000 * 1000, // 约 60MB，超出后触发清理

              /* 自定义loader */
              loader: blockAdEnabledRef.current
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader,
            });

            downloadMeter.available = true;
            hls.on(Hls.Events.FRAG_LOADING, (_, data) =>
              downloadMeter.track(data.frag.stats)
            );
            hls.on(Hls.Events.FRAG_LOADED, (_, data) =>
              downloadMeter.track(data.frag.stats)
            );
            hls.on(Hls.Events.MANIFEST_PARSED, () =>
              startup.mark('下载视频分片')
            );
            hls.on(Hls.Events.FRAG_LOADED, () =>
              startup.mark('等待解码与播放')
            );
            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            ensureVideoSource(video, url);

            const hlsSourceKey = installedSourceKey.current;
            let recoveryAttempted = false;
            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              console.error('HLS Error:', event, data);
              if (data.fatal) {
                if (!playbackMounted.current || video.hls !== hls) return;
                if (recoveryAttempted) {
                  hls.stopLoad();
                  reportPlaybackFailure(hlsSourceKey);
                  return;
                }
                recoveryAttempted = true;
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('网络错误，尝试恢复...');
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('媒体错误，尝试恢复...');
                    hls.recoverMediaError();
                    break;
                  default:
                    console.log('无法恢复的错误');
                    hls.destroy();
                    reportPlaybackFailure(hlsSourceKey);
                    break;
                }
              }
            });
          },
        },
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        settings: [
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已开启' : '已关闭',
            onClick() {
              const newVal = !blockAdEnabled;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (
                    artPlayerRef.current.video &&
                    artPlayerRef.current.video.hls
                  ) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal);
              } catch (_) {
                // ignore
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
          {
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '删除跳过配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          {
            name: '设置片头',
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                };
                handleSkipConfigChange(newConfig);
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            name: '设置片尾',
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '设置片尾时间'
                : `-${formatTime(-skipConfigRef.current.outro_time)}`,
            onClick: function () {
              const outroTime =
                -(
                  artPlayerRef.current?.duration -
                  artPlayerRef.current?.currentTime
                ) || 0;
              if (outroTime < 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  outro_time: outroTime,
                };
                handleSkipConfigChange(newConfig);
                return `-${formatTime(-outroTime)}`;
              }
            },
          },
        ],
        // 控制栏配置
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
        ],
      });

      setStatsTarget({
        container: artPlayerRef.current.template.$player,
        video: artPlayerRef.current.video,
      });
      artPlayerRef.current.on('video:loadeddata', () => {
        if (playbackMounted.current)
          startedSources.current.add(sourceAttemptKey());
      });
      artPlayerRef.current.on('video:playing', () => {
        startup.mark('画面已播放');
        rememberEpisode(
          videoTitleRef.current,
          videoYearRef.current,
          currentEpisodeIndexRef.current
        );
        const url = new URL(window.location.href);
        url.searchParams.set(
          'episode',
          String(currentEpisodeIndexRef.current + 1)
        );
        window.history.replaceState(window.history.state, '', url.toString());
      });

      // 监听播放器事件
      artPlayerRef.current.on('ready', () => {
        setError(null);
      });

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
      });

      // 监听视频可播放事件，这时恢复播放进度更可靠
      artPlayerRef.current.on('video:canplay', () => {
        if (!playbackMounted.current || !artPlayerRef.current) return;
        startedSources.current.add(sourceAttemptKey());
        const sourceKey = `${currentSourceRef.current}-${currentIdRef.current}`;
        const width = artPlayerRef.current.video.videoWidth;
        setPrecomputedVideoInfo((previous) => {
          const measured = previous.get(sourceKey);
          return new Map(previous).set(sourceKey, {
            quality: width
              ? qualityForWidth(width)
              : measured?.quality || '未知',
            loadSpeed: measured?.loadSpeed || '未测得',
            pingTime: measured?.pingTime || 0,
            latencyKind: measured?.latencyKind || null,
            status: 'playable',
            message: '当前播放器已确认可播放',
          });
        });
        // 若存在需要恢复的播放进度，则跳转
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('成功恢复播放进度到:', resumeTimeRef.current);
          } catch (err) {
            console.warn('恢复播放进度失败:', err);
          }
        }
        resumeTimeRef.current = null;

        const readyPlayer = artPlayerRef.current;
        setTimeout(() => {
          if (!playbackMounted.current || artPlayerRef.current !== readyPlayer)
            return;
          if (
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          if (
            Math.abs(
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
            ) > 0.01 &&
            isWebkit
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
          artPlayerRef.current.notice.show = '';
        }, 0);

        // 隐藏换源加载状态
        setIsVideoLoading(false);
      });

      // 监听视频时间更新事件，实现跳过片头片尾
      artPlayerRef.current.on('video:timeupdate', () => {
        if (!skipConfigRef.current.enable) return;

        const currentTime = artPlayerRef.current.currentTime || 0;
        const duration = artPlayerRef.current.duration || 0;
        const now = Date.now();

        // 限制跳过检查频率为1.5秒一次
        if (now - lastSkipCheckRef.current < 1500) return;
        lastSkipCheckRef.current = now;

        // 跳过片头
        if (
          skipConfigRef.current.intro_time > 0 &&
          currentTime < skipConfigRef.current.intro_time
        ) {
          artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
          artPlayerRef.current.notice.show = `已跳过片头 (${formatTime(
            skipConfigRef.current.intro_time
          )})`;
        }

        // 跳过片尾
        if (
          skipConfigRef.current.outro_time < 0 &&
          duration > 0 &&
          currentTime >
            artPlayerRef.current.duration + skipConfigRef.current.outro_time
        ) {
          if (
            currentEpisodeIndexRef.current <
            (detailRef.current?.episodes?.length || 1) - 1
          ) {
            handleNextEpisode();
          } else {
            artPlayerRef.current.pause();
          }
          artPlayerRef.current.notice.show = `已跳过片尾 (${formatTime(
            skipConfigRef.current.outro_time
          )})`;
        }
      });

      artPlayerRef.current.on('video:loadeddata', () => {
        if (playbackMounted.current)
          startedSources.current.add(sourceAttemptKey());
      });
      artPlayerRef.current.on('video:playing', () => {
        if (!playbackMounted.current) return;
        startedSources.current.add(sourceAttemptKey());
        setPlaybackError('');
        setIsVideoLoading(false);
      });
      artPlayerRef.current.on('video:error', () => reportPlaybackFailure());
      artPlayerRef.current.on('error', () => reportPlaybackFailure());

      // 监听视频播放结束事件，自动播放下一集
      artPlayerRef.current.on('video:ended', () => {
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          const endedSource = sourceAttemptKey();
          setTimeout(() => {
            if (!playbackMounted.current || sourceAttemptKey() !== endedSource)
              return;
            setCurrentEpisodeIndex(idx + 1);
          }, 1000);
        }
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        const now = Date.now();
        let interval = 5000;
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'd1') {
          interval = 10000;
        }
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
          interval = 20000;
        }
        if (now - lastSaveTimeRef.current > interval) {
          saveCurrentPlayProgress();
          lastSaveTimeRef.current = now;
        }
      });

      artPlayerRef.current.on('pause', () => {
        saveCurrentPlayProgress();
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
    } catch (err) {
      console.error('创建播放器失败:', err);
      setError('播放器初始化失败');
    }
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled, playbackRetry]);

  if (error === '当前所有源均不可用') {
    return (
      <PageLayout activePath='/play'>
        <div className='flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center'>
          <p role='status' className='text-xl font-medium'>
            当前所有源均不可用
          </p>
          <p className='text-sm text-gray-500'>
            所有片源均未测得播放速度，请稍后重新检测。
          </p>
          <button
            onClick={() => window.location.reload()}
            className='rounded-lg bg-blue-600 px-5 py-2 text-white'
          >
            重新检测
          </button>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex min-h-[75vh] items-center justify-center px-5'>
          <div className='glass-panel w-full max-w-md p-8 text-center'>
            <h2 className='text-xl font-semibold'>暂时无法播放</h2>
            <p role='status' className='mt-4 text-sm leading-7 text-gray-500'>
              {error}
            </p>
            <div className='mt-7 flex justify-center gap-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='rounded-xl border border-blue-200 px-5 py-2.5 text-sm text-blue-600 dark:border-blue-900 dark:text-blue-400'
              >
                返回搜索
              </button>
              <button
                onClick={() => window.location.reload()}
                className='rounded-xl bg-blue-600 px-5 py-2.5 text-sm text-white'
              >
                重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      activePath='/play'
      playbackHeader={
        <div className='flex min-w-0 items-center gap-2'>
          <h1
            title={videoTitle}
            className='min-w-0 flex-1 font-semibold text-gray-900 dark:text-gray-100'
          >
            {videoTitle || '影片标题'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>
                {` > 第 ${currentEpisodeIndex + 1} 集`}
              </span>
            )}
          </h1>
          {searchParams.has('kids_id') && (
            <span
              aria-label='播放语言'
              className='max-w-[80px] shrink-0 truncate rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/50 dark:text-sky-200'
            >
              {(() => {
                const language = kidsLanguage(
                  detail || {
                    title: '',
                    language: searchParams.get('kids_language') || '',
                  }
                );
                return language.code === 'unknown' ||
                  language.code.startsWith('multi')
                  ? language.label
                  : `${language.label}版`;
              })()}
            </span>
          )}
          <button
            onClick={() =>
              setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
            }
            aria-expanded={!isEpisodeSelectorCollapsed}
            title={isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'}
            className='hidden h-8 shrink-0 items-center rounded-lg px-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 lg:inline-flex'
          >
            {isEpisodeSelectorCollapsed ? '显示选集' : '隐藏选集'}
          </button>
        </div>
      }
    >
      <div className='playback-page flex flex-col gap-5 py-7 px-4 lg:px-[2rem] 2xl:px-12'>
        {/* 第二行：播放器和选集 */}
        <div className='space-y-2'>
          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            {/* 播放器 */}
            <div
              className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  aria-label='视频播放器'
                  className='player-frame w-full h-full bg-black'
                ></div>

                {statsTarget && (
                  <PlaybackStats
                    container={statsTarget.container}
                    video={statsTarget.video}
                    meter={downloadMeter}
                    episode={currentEpisodeIndex + 1}
                    total={totalEpisodes}
                    mediaKey={videoUrl}
                  />
                )}

                {playbackError && (
                  <div className='absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/85 p-5 text-white'>
                    <p role='alert'>{playbackError}</p>
                    <button
                      className='rounded-lg bg-blue-600 px-4 py-2 text-sm'
                      onClick={() => {
                        attemptedSources.current.clear();
                        attemptedUrls.current.clear();
                        setPlaybackFailure(false);
                        setPlaybackError('');
                        setIsVideoLoading(true);
                        artPlayerRef.current?.destroy();
                        artPlayerRef.current = null;
                        setPlaybackRetry((value) => value + 1);
                      }}
                    >
                      重新播放
                    </button>
                  </div>
                )}
                {(loading || isVideoLoading) && (
                  <div className='pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/80'>
                    <p role='status' className='text-sm text-white'>
                      {loading
                        ? loadingMessage
                        : videoLoadingStage === 'sourceChanging'
                        ? '正在切换片源…'
                        : '正在加载视频…'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 选集和换源 - 在移动端始终显示，在 lg 及以上可折叠 */}
            <div
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                key={`${videoTitle}-${currentEpisodeIndex}`}
                probeEpisodeIndex={currentEpisodeIndex}
                totalEpisodes={totalEpisodes}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={
                  measuredEpisodeIndex === currentEpisodeIndex
                    ? precomputedVideoInfo
                    : undefined
                }
                onAllSourcesUnavailable={() => {
                  if (!artPlayerRef.current?.playing)
                    setSourceSearchError('预检未测得速度，可手动切换片源');
                }}
              />
            </div>
          </div>
        </div>

        <DoubanComments
          title={videoTitle}
          year={videoYear || detail?.year || ''}
          doubanId={
            searchParams.get('douban_id') || String(detail?.douban_id || '')
          }
          kind={searchParams.get('douban_type') || searchType}
        />

        {/* 详情展示 */}
        <div className='glass-panel grid grid-cols-1 md:grid-cols-4 gap-4 p-3'>
          {/* 文字区 */}
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              {/* 标题 */}
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                {videoTitle || '影片标题'}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
                >
                  <FavoriteIcon filled={favorited} />
                </button>
              </h1>

              {/* 关键信息行 */}
              <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                {detail?.class && (
                  <span className='text-blue-600 font-semibold'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span>{detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && <span>{detail.type_name}</span>}
              </div>
              {/* 剧情简介 */}
              {detail?.desc && (
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          {/* 封面展示 */}
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <img
                    src={processImageUrl(videoCover)}
                    alt={videoTitle}
                    className='w-full h-full object-cover'
                  />
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444' /* Tailwind red-500 */
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
