import movieCatalog from './kids-movie-catalog.json';

// Editorial selections with attributed title/release facts; no videos,
// third-party synopses or artwork are bundled.
// Historical age metadata is editorial only; browsing is organized by series and films.
export const KIDS_AGE_GROUPS = [
  {
    id: '2-4',
    label: '2–4 岁',
    title: '亲子启蒙',
    description: '一起认识生活、表达感受，慢慢发现世界。',
  },
  {
    id: '5-7',
    label: '5–7 岁',
    title: '探索成长',
    description: '跟着故事探索自然、科学和与朋友相处的方法。',
  },
  {
    id: '8-12',
    label: '8–12 岁',
    title: '知识冒险',
    description: '从历史、文化与成长故事里，打开更多问题。',
  },
] as const;
export type KidsAgeGroup = (typeof KIDS_AGE_GROUPS)[number]['id'];
export interface KidsTitle {
  id: string;
  name: string;
  kind: 'movie' | 'tv';
  age: KidsAgeGroup;
  theme: string;
  description: string;
  symbol: string;
  year?: string;
  aliases?: string[];
  releaseYears?: string[];
  catalogSource?: {
    provider: 'bangumi';
    id: number;
    url: string;
    snapshot: string;
  };
}
const ORIGINAL_KIDS_TITLES: KidsTitle[] = [
  {
    id: 'peppa',
    name: '小猪佩奇 第一季',
    kind: 'tv',
    age: '2-4',
    theme: '生活习惯',
    description: '从一家人的小日常，聊聊轮流、分享和相互照顾。',
    symbol: '☀️',
  },
  {
    id: 'penelope',
    name: '蓝色小考拉',
    kind: 'tv',
    age: '2-4',
    theme: '生活习惯',
    description: '和小考拉一起练习穿衣、整理与独立完成小事情。',
    symbol: '🐨',
  },
  {
    id: 'maisy',
    name: '小鼠波波',
    kind: 'tv',
    age: '2-4',
    theme: '生活习惯',
    description: '用轻松的小故事认识生活场景，适合边看边聊。',
    symbol: '🌼',
  },
  {
    id: 'garden',
    name: '花园宝宝',
    kind: 'tv',
    age: '2-4',
    theme: '情绪表达',
    description: '在重复的节奏与伙伴互动中，观察动作和感受。',
    symbol: '🌿',
  },
  {
    id: 'duggee',
    name: '嗨！道奇 第一季',
    kind: 'tv',
    age: '2-4',
    theme: '朋友合作',
    description: '伙伴们一同完成小挑战，试着表达想法与合作。',
    symbol: '🐾',
  },
  {
    id: 'ricky',
    name: '瑞奇宝宝',
    kind: 'tv',
    age: '2-4',
    theme: '情绪表达',
    description: '围绕好奇心与日常感受，认识自己和身边的朋友。',
    symbol: '🌈',
  },
  {
    id: 'rainbow',
    name: '小鸡彩虹',
    kind: 'tv',
    age: '2-4',
    theme: '朋友合作',
    description: '跟随彩色小伙伴的相处故事，讨论体谅与帮助。',
    symbol: '🐥',
  },
  {
    id: 'teletubbies',
    name: '天线宝宝',
    kind: 'tv',
    age: '2-4',
    theme: '生活习惯',
    description: '借助简单的声音、动作和游戏，发现熟悉的事物。',
    symbol: '🎈',
  },
  {
    id: 'octonauts',
    name: '海底小纵队 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '自然科学',
    description: '跟随海底任务认识动物，也学习团队如何分工。',
    symbol: '🐙',
  },
  {
    id: 'fixies',
    name: '螺丝钉 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '自然科学',
    description: '从身边的机器出发，问问它们为什么能够工作。',
    symbol: '⚙️',
  },
  {
    id: 'superwings',
    name: '超级飞侠 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '朋友合作',
    description: '在不同地方的任务中，认识新朋友并一起解决困难。',
    symbol: '✈️',
  },
  {
    id: 'pawpatrol',
    name: '汪汪队立大功 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '朋友合作',
    description: '通过团队救援故事，讨论勇气、分工与求助。',
    symbol: '🐶',
  },
  {
    id: 'mickey',
    name: '米奇妙妙屋 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '思维游戏',
    description: '把观察、数量和选择工具，变成可以一起回答的小问题。',
    symbol: '🧩',
  },
  {
    id: 'dora',
    name: '爱探险的朵拉 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '思维游戏',
    description: '边找路边做选择，练习观察、记忆与简单的表达。',
    symbol: '🗺️',
  },
  {
    id: 'tutu',
    name: '大耳朵图图 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '情绪表达',
    description: '从孩子的疑问和家庭生活中，谈谈规则与感受。',
    symbol: '💬',
  },
  {
    id: 'qiaohu',
    name: '巧虎来啦',
    kind: 'tv',
    age: '5-7',
    theme: '生活习惯',
    description: '围绕生活任务与伙伴相处，练习表达和自我照顾。',
    symbol: '🐯',
  },
  {
    id: 'historycats',
    name: '如果历史是一群喵 第一季',
    kind: 'tv',
    age: '8-12',
    theme: '历史文化',
    description: '用轻松的故事作为入口，再一起核对历史人物与事件。',
    symbol: '📜',
  },
  {
    id: 'poems',
    name: '中国唱诗班',
    kind: 'tv',
    age: '8-12',
    theme: '历史文化',
    description: '从诗词与画面中的生活，感受传统文化的情境。',
    symbol: '🪷',
  },
  {
    id: 'master',
    name: '少年师爷',
    kind: 'tv',
    age: '8-12',
    theme: '思维游戏',
    description: '观察故事里的线索，讨论人物如何思考和解决问题。',
    symbol: '🔎',
  },
  {
    id: 'shuke',
    name: '舒克贝塔',
    kind: 'tv',
    age: '8-12',
    theme: '成长冒险',
    description: '在伙伴的冒险中，讨论选择、责任与彼此支持。',
    symbol: '🚁',
  },
  {
    id: 'insideout',
    name: '头脑特工队',
    kind: 'movie',
    age: '8-12',
    theme: '情绪表达',
    description: '适合亲子共看，一起聊聊成长中复杂而真实的情绪。',
    symbol: '💡',
  },
  {
    id: 'totoro',
    name: '龙猫',
    kind: 'movie',
    age: '8-12',
    theme: '自然科学',
    description: '从姐妹的日常与森林想象，聊自然、家人和心里的担忧。',
    symbol: '🌳',
  },
  {
    id: 'toystory',
    name: '玩具总动员',
    kind: 'movie',
    age: '8-12',
    theme: '朋友合作',
    description: '跟着玩具伙伴一起出发，看看友情与合作的力量。',
    symbol: '⭐',
  },
  {
    id: 'zootopia',
    name: '疯狂动物城',
    kind: 'movie',
    age: '8-12',
    theme: '成长冒险',
    description: '以冒险故事讨论偏见、努力与合作，含追逐紧张情节。',
    symbol: '🦊',
  },
  {
    id: 'frozen',
    name: '冰雪奇缘',
    kind: 'movie',
    age: '8-12',
    theme: '朋友合作',
    description: '和姐妹一起走进冰雪王国，听勇气与亲情的故事。',
    symbol: '❄️',
  },
  {
    id: 'coco',
    name: '寻梦环游记',
    kind: 'movie',
    age: '8-12',
    theme: '成长冒险',
    description: '跟随音乐少年寻找梦想，认识家人与回忆的意义。',
    symbol: '🎸',
  },
  {
    id: 'nemo',
    name: '海底总动员',
    kind: 'movie',
    age: '8-12',
    theme: '自然科学',
    description: '游进海底世界，和小丑鱼一起经历寻找与成长。',
    symbol: '🐠',
  },
  {
    id: 'walle',
    name: '机器人总动员',
    kind: 'movie',
    age: '8-12',
    theme: '自然科学',
    description: '认识一位热爱地球的机器人，踏上一场太空冒险。',
    symbol: '🤖',
  },
  {
    id: 'kungfupanda',
    name: '功夫熊猫',
    kind: 'movie',
    age: '8-12',
    theme: '成长冒险',
    description: '和熊猫阿宝一起练习、合作，发现自己的长处。',
    symbol: '🐼',
  },
  {
    id: 'bighero',
    name: '超能陆战队',
    kind: 'movie',
    age: '8-12',
    theme: '朋友合作',
    description: '跟着大白和伙伴们，用发明与合作应对新挑战。',
    symbol: '🤗',
  },
  {
    id: 'croods',
    name: '疯狂原始人',
    kind: 'movie',
    age: '8-12',
    theme: '成长冒险',
    description: '与一家人走出熟悉的山洞，发现一个全新的世界。',
    symbol: '🌋',
  },
  {
    id: 'boonie',
    name: '熊出没之夺宝熊兵',
    kind: 'movie',
    age: '8-12',
    theme: '朋友合作',
    description: '和熊大熊二一起保护新朋友，体验森林里的热闹冒险。',
    symbol: '🐻',
  },
  {
    id: 'bluey',
    name: '布鲁伊 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '朋友合作',
    description: '和一家人一起玩游戏，发现日常生活的小快乐。',
    symbol: '🐶',
  },
  {
    id: 'pony',
    name: '小马宝莉：友谊大魔法 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '朋友合作',
    description: '跟随小马伙伴认识友谊，学习沟通与互相帮助。',
    symbol: '🦄',
  },
  {
    id: 'thomas',
    name: '托马斯和他的朋友们 第一季',
    kind: 'tv',
    age: '5-7',
    theme: '朋友合作',
    description: '和小火车伙伴一起完成任务，认识责任与合作。',
    symbol: '🚂',
  },
  {
    id: 'bears',
    name: '熊出没',
    kind: 'tv',
    age: '5-7',
    theme: '成长冒险',
    description: '和森林伙伴一起经历热闹故事，发现守护自然的意义。',
    symbol: '🐻',
  },
  {
    id: 'pleasantgoat',
    name: '喜羊羊与灰太狼',
    kind: 'tv',
    age: '5-7',
    theme: '成长冒险',
    description: '跟着羊村伙伴们动脑筋，用合作解决冒险中的难题。',
    symbol: '🐑',
  },
  {
    id: 'doraemon',
    name: '哆啦A梦',
    kind: 'tv',
    age: '5-7',
    theme: '思维游戏',
    description: '和来自未来的伙伴一起思考，看看选择带来的不同结果。',
    symbol: '🤖',
  },
];
// Names, aliases and release facts were checked against this dated public archive.
// Selection and descriptions are editorial; the archive is not an age rating or video source.
export const KIDS_CATALOG_SNAPSHOT = '2026-11-03';
export const KIDS_CATALOG_SOURCE =
  'https://github.com/bangumi/Archive/releases/tag/archive';
const movieEntries: KidsTitle[] = movieCatalog.map((item) => ({
  id: item.id,
  name: item.name,
  year: item.year,
  aliases: item.aliases,
  kind: 'movie',
  age: '8-12',
  theme: '成长冒险',
  description: '一起欣赏动画故事，聊聊角色的选择、成长与合作。',
  symbol: '🎬',
  catalogSource: {
    provider: 'bangumi',
    id: item.bangumiId,
    url: `https://bgm.tv/subject/${item.bangumiId}`,
    snapshot: KIDS_CATALOG_SNAPSHOT,
  },
  // Regional premieres and restored editions have multiple legitimate source years.
  ...(item.bangumiId === 1962
    ? { releaseYears: ['1961', '1964', '1978', '2017'] }
    : item.bangumiId === 36186
    ? { releaseYears: ['1983', '2021'] }
    : item.bangumiId === 119356
    ? { releaseYears: ['2014', '2015', '2016'] }
    : {}),
}));
export const KIDS_TITLES: KidsTitle[] = [
  ...ORIGINAL_KIDS_TITLES.map((item) => {
    const movie = movieEntries.find((entry) => entry.id === item.id);
    return movie ? { ...movie, ...item } : item;
  }),
  ...movieEntries.filter(
    (item) => !ORIGINAL_KIDS_TITLES.some((entry) => entry.id === item.id)
  ),
];

export function kidsAgeGroup(value: string | null): KidsAgeGroup {
  return KIDS_AGE_GROUPS.some((group) => group.id === value)
    ? (value as KidsAgeGroup)
    : '2-4';
}
export function filterKidsTitles(
  age: KidsAgeGroup,
  theme = '全部',
  query = ''
): KidsTitle[] {
  const search = query.trim().toLowerCase();
  return KIDS_TITLES.filter(
    (item) =>
      item.age === age &&
      (theme === '全部' || item.theme === theme) &&
      `${item.name} ${(item.aliases || []).join(' ')} ${item.theme} ${
        item.description
      }`
        .toLowerCase()
        .includes(search)
  );
}
export function kidsDetailHref(item: KidsTitle, age: KidsAgeGroup): string {
  const params = new URLSearchParams({
    title: item.name,
    stype: item.kind,
    douban_type: item.kind,
    returnTo: `/kids?age=${age}`,
  });
  if (item.year) params.set('year', item.year);
  return `/play?${params}`;
}

export type KidsKind = 'tv' | 'movie';
export const KIDS_KINDS = [
  { id: 'tv', label: '动画剧集', symbol: '📺' },
  { id: 'movie', label: '动画电影', symbol: '🍿' },
] as const;
export function kidsKind(value: string | null): KidsKind {
  return value === 'movie' ? 'movie' : 'tv';
}
export function kidsTitlesByKind(kind: KidsKind, query = ''): KidsTitle[] {
  const text = query.trim().toLowerCase();
  return KIDS_TITLES.filter(
    (item) =>
      item.kind === kind &&
      `${item.name} ${(item.aliases || []).join(' ')} ${item.theme}`
        .toLowerCase()
        .includes(text)
  );
}
