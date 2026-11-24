/* ============================================================
   미정 클래스 — data layer
   ------------------------------------------------------------
   이 파일 하나에 (1) 화면에 쓰이는 콘텐츠와 (2) 예약/수강권 API가
   함께 있습니다. 지금은 localStorage 어댑터로 동작하고, 실제 운영 시
   아래 `api` 안의 함수 본문만 Supabase 등 서버 호출로 바꾸면
   app.js는 그대로 쓸 수 있습니다. (함수 시그니처는 모두 async)

   ─ Supabase로 옮길 때
     api.listSessions()  → supabase.from('sessions').select()
     api.book()          → supabase.rpc('book_session', {...})
     api.cancel()        → supabase.rpc('cancel_booking', {...})
     api.grantPass()     → supabase.rpc('grant_pass', {...})
   ============================================================ */

'use strict';

/* ── 브랜드 & 규칙 ───────────────────────────────────────── */
const CONFIG = {
  brand: {
    handle: '@mi.jeong_k',
    name: '미정',
    instagram: 'https://www.instagram.com/mi.jeong_k/',
  },
  storageKey: 'mijeong.class.v1',
  cancelDeadlineMs: 60 * 60 * 1000, // 수업 시작 1시간 전까지 취소 가능
  bookingWindowDays: 14,            // 예약 화면에 보여줄 기간
  passTypes: {
    1: { count: 1, validDays: 30, label: '1회권' },
    4: { count: 4, validDays: 60, label: '4회권' },
    8: { count: 8, validDays: 90, label: '8회권' },
  },
};

/* 수업별 유효기간 예외
   - 값이 null 이면 그 수업의 그 수강권은 유효기간이 없습니다 (만료 체크 없음).
   - 여기에 없는 조합은 CONFIG.passTypes[권종].validDays 를 씁니다. */
const PASS_VALIDITY = {
  functional: { 1: null }, // 펑셔널 요가 1회권 — 유효기간 없음
};

function passValidDays(classId, passType) {
  const table = PASS_VALIDITY[classId];
  if (table && Object.prototype.hasOwnProperty.call(table, passType)) return table[passType];
  const t = CONFIG.passTypes[passType];
  return t ? t.validDays : null;
}

/* ── 금액 ─────────────────────────────────────────────────
   강사에게 확인된 금액만 적습니다. null 은 '금액 추후 안내'(별도 문의).
   - 오프라인 수업은 수강권으로 결제하므로 수업별 수강권 금액을 둡니다.
     수강권은 한 장이라 여러 수업을 골라도 계산은 확정된 금액 한 번만 합니다.
   - 온라인 수업은 수강권 없이 수업 단위로 결제합니다.
   금액이 정해지면 아래 표에 숫자를 넣기만 하면 화면·합계가 함께 바뀝니다. */
const PRICES = {
  unknownLabel: '금액 추후 안내',
  /* 오프라인 수강권 금액 (수업별 · 수업마다 있는 권종이 다릅니다) */
  offlinePass: {
    handstand: { 4: 180000, 8: 300000 },
    functional: { 1: 35000, 4: 120000, 8: 200000 },
  },
  /* 온라인 수업 금액 (was = 지난 얼리버드 가격과 종료일, weeks = 진행 기간) */
  online: {
    morning: { amount: 59000, was: { amount: 49000, until: '2026-11-20' } },
    coaching: { amount: 300000, weeks: 7 },
  },
};

/* 수업 하나의 수강권 금액 — 확정되지 않았으면 null */
function passPriceOf(classId, passType) {
  const table = PRICES.offlinePass[classId];
  if (!table) return null;
  const n = table[passType];
  return typeof n === 'number' ? n : null;
}

/* 고른 오프라인 수업들에 대한 수강권 금액 — 수업마다 수강권을 내므로 각 수업 금액의 합 */
function offlinePassPrice(classes, passType) {
  const amounts = (classes || [])
    .map((id) => passPriceOf(id, passType))
    .filter((n) => typeof n === 'number');
  if (!amounts.length) return null;
  return amounts.reduce((sum, n) => sum + n, 0);
}

/* 수업 하나로 살 수 있는 수강권 종류 — 금액표에 있는 권종만 */
function passTypesOfClass(classId) {
  const table = PRICES.offlinePass[classId];
  if (!table) return [];
  return Object.keys(table).map(Number).filter((n) => CONFIG.passTypes[n]).sort((a, b) => a - b);
}

/* 수업들 모두에 쓸 수 있는 공통 수강권 종류 (오프라인 수업이 없으면 전부) */
function passTypesOfClasses(classes) {
  const offline = offlineOf(classes);
  const all = Object.keys(CONFIG.passTypes).map(Number).sort((a, b) => a - b);
  if (!offline.length) return all;
  return all.filter((n) => offline.every((id) => passPriceOf(id, n) != null));
}

/* 온라인 수업 금액 — 확정되지 않았으면 null */
function onlinePriceOf(classId) {
  const info = PRICES.online[classId];
  return info && typeof info.amount === 'number' ? info.amount : null;
}

/* 고른 수업으로 살 수 없는 수강권이면 이유를 알려 줍니다 */
function assertPassFits(classes, passType) {
  if (passType === undefined || passType === null || passType === '') return;
  const allowed = passTypesOfClasses(classes);
  if (allowed.indexOf(Number(passType)) !== -1) return;
  const labels = allowed.map((n) => (CONFIG.passTypes[n] || {}).label).filter(Boolean).join(' · ');
  throw new Error(labels
    ? `이 수업은 ${labels}로만 신청할 수 있어요.`
    : '이 수업에 쓸 수 있는 수강권이 아직 정해지지 않았어요.');
}

/* ── 수업 ──────────────────────────────────────────────── */
/* mode: 'offline' = 스튜디오 수업 / 'online' = 온라인 클래스
   slots: dow 0=일 … 6=토, start/end = 'HH:MM'
   온라인 클래스는 정해진 시간표 대신 `when` 문구로 안내합니다. */
const CLASSES = [
  {
    id: 'handstand',
    name: '핸드스탠드 무브먼트',
    en: 'Handstand Movement',
    icon: 'handstand',
    mode: 'offline',
    duration: '90분',
    slots: [
      { dow: 3, start: '14:00', end: '15:30' },
      { dow: 4, start: '14:00', end: '15:30' },
      { dow: 6, start: '12:00', end: '13:30' },
      { dow: 0, start: '12:00', end: '13:30' },
    ],
    /* 수업 소개 카드 그림 — 포스터 사진(4:5). 없으면 SVG 일러스트로 그립니다. */
    poster: './assets/handstand-movement.jpg',
    posterAlt: '핸드스탠드 무브먼트 포스터 — 거꾸로 홀로서기 프로젝트, 매주 수·목·토·일 오후 클래스',
    blurb:
      '벽에서 시작해 손으로 서는 감각까지. 90분 동안 어깨와 손목의 정렬을 만들고, kick up · straddle · split을 단계별로 쌓아갑니다. 같은 시간에 비기너와 인터미디엇이 각자의 순서로 움직입니다.',
    note: 'P3 · Beginner / Intermediate',
  },
  {
    id: 'functional',
    name: '펑셔널 요가',
    en: 'Functional Yoga',
    icon: 'functional',
    mode: 'offline',
    duration: '60분',
    slots: [{ dow: 0, start: '10:00', end: '11:00' }],
    blurb:
      '일상에서 쓰는 움직임을 기준으로 몸을 정리하는 60분. 호흡에 맞춰 골반과 어깨의 움직임을 넓히고, 힘을 쓰는 방향을 다시 잡습니다. 일요일 아침을 여는 수업입니다.',
    note: '호흡 · 골반 · 어깨',
  },
  {
    id: 'morning',
    name: '모닝 모빌리티',
    en: 'Morning Mobility',
    icon: 'mobility',
    mode: 'online',
    duration: null,
    slots: [],
    when: '온라인 클래스 · 일정/신청은 인스타 DM',
    /* 수업 소개 카드 그림 — 포스터 사진(4:5). 없으면 SVG 일러스트로 그립니다. */
    poster: './assets/morning-mobility.jpg',
    posterAlt: '모닝 모빌리티 포스터 — 어디서든, 아침 15분. 온라인 모닝 모빌리티 챌린지 모집',
    blurb:
      '아침에 몸을 깨우는 온라인 모빌리티 클래스입니다. 잠결에 굳은 관절을 부드럽게 풀고 하루의 움직임을 편하게 여는 루틴을 함께 합니다. 집에서 매트 하나로 이어갈 수 있어요.',
    note: '온라인 · 일정/신청 문의',
  },
  {
    id: 'coaching',
    name: '핸드스탠드 온라인 코칭',
    en: 'Handstand Online Coaching',
    icon: 'online',
    mode: 'online',
    duration: null,
    slots: [],
    when: '온라인 코칭 · 7주 · 개별/정기 진행',
    period: '7주',
    blurb:
      '7주 동안 온라인으로 피드백과 맞춤 연습을 주고받으며 핸드스탠드를 이어가는 코칭입니다. 오프라인 수업에서 잡은 감각을 집에서 놓지 않도록, 지금 수준에 맞는 연습을 골라 드립니다.',
    note: '온라인 · 7주 과정 · 인스타 DM 신청',
  },
];

/* ── 수강 수업(접근 권한) ─────────────────────────────────
   수강생은 4가지 수업 중 열린 수업만 볼 수 있습니다.
   - 오프라인: handstand(핸드스탠드 무브먼트) · functional(펑셔널 요가)
   - 온라인: morning(모닝 모빌리티) · coaching(핸드스탠드 온라인 코칭)
   수업 시퀀스(#sequence)는 핸드스탠드 수업을 듣는 수강생에게만 열립니다. */
const CLASS_ORDER = ['handstand', 'functional', 'morning', 'coaching'];
const OFFLINE_CLASS_IDS = ['handstand', 'functional'];
const ONLINE_CLASS_IDS = ['morning', 'coaching']; /* ONLINE 프로그램 키와 같습니다 */

function normalizeClasses(list) {
  const given = Array.isArray(list) ? list : [];
  return CLASS_ORDER.filter((id) => given.indexOf(id) !== -1);
}

function offlineOf(classes) {
  return OFFLINE_CLASS_IDS.filter((id) => (classes || []).indexOf(id) !== -1);
}

function classNameOf(classId) {
  const cls = CLASSES.find((c) => c.id === classId);
  return cls ? cls.name : classId;
}

function onlineOf(classes) {
  return ONLINE_CLASS_IDS.filter((id) => (classes || []).indexOf(id) !== -1);
}

/* 수강생이 볼 수 있는 영역 */
function accessFor(student) {
  const classes = normalizeClasses(student && student.classes);
  return {
    classes,
    offline: offlineOf(classes),
    online: onlineOf(classes),
    sequence: classes.indexOf('handstand') !== -1,
  };
}

/* ── 수강권 (수업별로 따로) ───────────────────────────────
   수강생은 오프라인 수업마다 자기 수강권을 가집니다.
   student.passes = { handstand: {type,total,used,issuedAt,expiresAt}, functional: {...} }
   expiresAt 이 null 이면 유효기간 없음 — 만료 체크를 하지 않습니다. */
function passIsActive(pass, at) {
  if (!pass) return false;
  const now = at == null ? Date.now() : at;
  if (passRemaining(pass) <= 0) return false;
  if (pass.expiresAt && now > new Date(pass.expiresAt).getTime()) return false;
  return true;
}

function passRemaining(pass) {
  return Math.max(0, Number(pass.total || 0) - Number(pass.used || 0));
}

/* 수강생이 지금 살아 있는(예약할 수 있는) 수강권을 가진 수업 */
function activeOfflineOf(student, at) {
  const offline = offlineOf(normalizeClasses(student && student.classes));
  return offline.filter((id) => passIsActive(student.passes && student.passes[id], at));
}

/* 앱에 보이는 수강권 한 장 */
function passView(pass, classId, at) {
  if (!pass) return null;
  const now = at == null ? Date.now() : at;
  const remaining = passRemaining(pass);
  const noExpiry = !pass.expiresAt;
  const expired = !noExpiry && now > new Date(pass.expiresAt).getTime();
  return {
    classId,
    type: Number(pass.type),
    total: Number(pass.total),
    used: Number(pass.used) || 0,
    remaining,
    issuedAt: pass.issuedAt || null,
    expiresAt: pass.expiresAt || null,
    validDays: noExpiry ? null : passValidDays(classId, Number(pass.type)),
    noExpiry,
    expired,
    active: remaining > 0 && !expired,
    label: (CONFIG.passTypes[pass.type] || {}).label || `${pass.type}회권`,
  };
}

/* ── 수업 시퀀스 (실제 수업 순서) ─────────────────────────── */
/* video.youtubeId 에 유튜브 영상 ID(예: 'dQw4w9WgXcQ')를 넣으면
   사이트 안 모달에서 바로 재생되고, 비어 있으면 '영상 준비 중'으로 표시됩니다.
   video.url 에는 전체 주소(https://youtu.be/...)를 넣어도 됩니다. */

const WARMUP = [
  {
    id: 'w1',
    name: '고관절 외전 내회전 / 외회전',
    tags: ['고관절', '공통'],
    dose: '10번 × 3세트',
    cue: '네발 자세에서 한쪽 다리를 옆으로 들어 무릎을 돌려요. 골반은 정면으로 고정하고, 허리가 흔들리지 않게 갈비뼈를 내린 채로.',
    video: { youtubeId: '', url: '' },
  },
  {
    id: 'w2',
    name: '다리벌려서 팬케이크 오른쪽 왼쪽 정면',
    tags: ['신전 ENG', '공통'],
    dose: '각 10번',
    cue: '다리를 넓게 벌려 앉아 오른쪽·왼쪽·정면 순서로 상체를 길게 뻗어요. 골반을 돌려 앉고, 손으로 바닥을 밀며 숨을 내쉬면서.',
    video: { youtubeId: '', url: '' },
  },
  {
    id: 'w3',
    name: '프로그자세 → 무릎들기',
    tags: ['고관절', '공통'],
    dose: '10번',
    cue: '개구리 자세에서 정강이를 바닥에 두고, 배를 끌어당겨 무릎을 살짝 띄워요. 상체는 낮게, 시선은 정면. 무릎이 아프면 수건을 받쳐 주세요.',
    video: { youtubeId: '', url: '' },
  },
];

const SEQUENCES = {
  beginner: [
    {
      id: 'b1',
      name: '할로우바디 홀드',
      tags: ['등면', '블록'],
      dose: '20초 × 5세트',
      cue: '등을 바닥에 대고 누워 발아래 블록을 받치고 엉덩이를 들어 올려요. 허리가 뜨지 않게 갈비뼈를 내리고, 호흡은 짧게 끊어서.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'b2',
      name: '손목 들기',
      tags: ['손목', '준비'],
      dose: '50번',
      cue: '손바닥을 바닥에 두고 손목을 앞뒤로 천천히 움직여요. 팔꿈치는 편하게, 통증이 있으면 범위를 줄이고 손가락 끝까지 힘을 빼 주세요.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'b3',
      name: '플랭크 숄더 슈러그',
      tags: ['좁은 파이크'],
      dose: '5번 × 5세트',
      cue: '좁은 파이크 자세에서 어깨를 귀 쪽으로 올렸다가, 견갑을 아래로 내려 등으로 바닥을 밀어요. 팔꿈치는 굽히지 말고 팔로 버텨 주세요.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'b4',
      name: '무릎내렸다가 좁은 파이크',
      tags: ['배·허벅지 밀착'],
      dose: '8–10번 × 5세트',
      cue: '무릎을 내려 앉았다가 좁은 파이크로 올라오면서 배를 허벅지에 붙여요. 올라올 때 갈비뼈가 들리지 않게, 골반은 뒤로.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'b5',
      name: 'tempo kick up',
      tags: ['탈출 없이'],
      dose: '10세트',
      cue: '천천히 차올리고, 내려올 때는 벽을 밀지 않고 버텨요. 탈출 동작 없이 중심을 잡는 연습입니다. 벽과의 거리를 조금씩 좁혀 보세요.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'b6',
      name: 'Walking to wall',
      tags: ['벽', '진입'],
      dose: '1회 × 5세트',
      cue: '벽까지 걸어가며 손을 짚고 몸을 세워요. 한 걸음씩, 골반이 수직 위로 올라가게. 발끝으로 벽을 밟고 어깨로 바닥을 밀어 주세요.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'b7',
      name: 'HS hold (under)',
      tags: ['벽 아래', '유지'],
      dose: '20초 × 5세트',
      cue: '벽 아래에서 20초 유지해요. 손목으로 바닥을 밀고 배에 힘을 준 채, 숨을 멈추지 않는 것이 목표. 버티기 어려우면 10초부터.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'b8',
      name: 'Cartwheel',
      tags: ['마무리', '5분'],
      dose: '5분',
      cue: '옆으로 넘어가며 손-발 순서를 익혀요. 5분 동안 반복. 겁이 나면 낮은 벽 옆에서, 손을 짚는 위치부터 천천히.',
      video: { youtubeId: '', url: '' },
    },
  ],
  intermediate: [
    {
      id: 'i1',
      name: '할로우바디 홀드',
      tags: ['등면', '블록'],
      dose: '20초 × 5세트',
      cue: '등을 바닥에 대고 누워 발아래 블록을 받치고 엉덩이를 들어 올려요. 허리가 뜨지 않게 갈비뼈를 내리고, 호흡은 짧게 끊어서.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'i2',
      name: '무릎내렸다가 좁은 파이크',
      tags: ['배·허벅지 밀착'],
      dose: '5번 × 5세트',
      cue: '무릎을 내려 앉았다가 좁은 파이크로 올라오면서 배를 허벅지에 붙여요. 비기너보다 적은 횟수로, 대신 올라오는 구간을 더 천천히.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'i3',
      name: 'tempo kick up',
      tags: ['탈출 없이'],
      dose: '10세트',
      cue: '천천히 차올리고, 내려올 때는 벽을 밀지 않고 버텨요. 탈출 동작 없이 중심을 잡는 연습. 내려오는 길을 스스로 통제해 보세요.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'i4',
      name: 'Walking to wall',
      tags: ['벽', '진입'],
      dose: '1회 × 5세트',
      cue: '벽까지 걸어가며 손을 짚고 몸을 세워요. 한 걸음씩, 골반이 수직 위로. 어깨가 벽에서 멀어질수록 좋아요.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'i5',
      name: 'HS split hold',
      tags: ['분할', '균형'],
      dose: '5번 시도',
      cue: '다리를 앞뒤로 갈라 유지해요. 5번 시도하며 중심선을 찾습니다. 앞다리는 들고, 뒷다리는 길게. 시선은 손 사이.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'i6',
      name: 'HS straddle hold',
      tags: ['스트래들'],
      dose: '20초 × 5세트',
      cue: '스트래들로 20초 × 5세트. 다리를 넓게 벌려 균형을 잡고, 손목과 어깨로 계속 바닥을 밀어 주세요.',
      video: { youtubeId: '', url: '' },
    },
    {
      id: 'i7',
      name: 'play time',
      tags: ['10분', 'HS straddle up'],
      dose: 'HS straddle up 3–5회 × 5세트',
      cue: '10분 플레이 타임. 스트래들 업을 3–5회씩 5세트, 실패해도 다시. 이 시간은 몸에게 맡기고, 오늘의 감각을 확인해요.',
      video: { youtubeId: '', url: '' },
    },
  ],
};

  /* class 카드용 메타 */

/* ════════════════════
   온라인 클래스 (영상 기반 자가 수련 + 주간 체크)
   ════════════════════
   각 프로그램은 movements 목록을 가지고, 수강생은 주차별로
   동작 × 요일 체크와 노트를 남깁니다. (localStorage → 운영 시 서버)
   - morning: 아침 모빌리티 8개 동작 (영상은 아직 미연결)
   - online-coaching: P3 시퀀스에서 고른 핵심 연습 8개 (영상 모달 공유) */

const SEQ_INDEX = new Map();
[...WARMUP, ...SEQUENCES.beginner, ...SEQUENCES.intermediate].forEach((item) => {
  if (!SEQ_INDEX.has(item.id)) SEQ_INDEX.set(item.id, item);
});

const COACHING_MOVEMENTS = ['b2', 'b1', 'b3', 'b4', 'b5', 'b6', 'b7', 'i5']
  .map((id) => SEQ_INDEX.get(id))
  .filter(Boolean);

const ONLINE = {
  morning: {
    id: 'morning',
    name: '모닝 모빌리티',
    en: 'Morning Mobility',
    sub: '주 4회, 하루 15분씩 스스로의 움직임을 체크해 보세요',
    noteLabel: 'Mobility Note',
    noteHint: '각자의 느낌들을 자유롭게 적어 보세요',
    movements: [
      { id: 'mm1', name: '어깨 내회전 · 외회전', dose: '', cue: '', video: { youtubeId: '', url: '' } },
      { id: 'mm2', name: '몸통 회전', dose: '', cue: '', video: { youtubeId: '', url: '' } },
      { id: 'mm3', name: '날개뼈 CARs', dose: '', cue: '', video: { youtubeId: '', url: '' } },
      { id: 'mm4', name: '어깨 CARs', dose: '', cue: '', video: { youtubeId: '', url: '' } },
      { id: 'mm5', name: '골반 시상면 움직임', dose: '', cue: '', video: { youtubeId: '', url: '' } },
      { id: 'mm6', name: '골반 관상면 움직임', dose: '', cue: '', video: { youtubeId: '', url: '' } },
      { id: 'mm7', name: '골반 횡단면 움직임', dose: '', cue: '', video: { youtubeId: '', url: '' } },
      { id: 'mm8', name: '고관절 내회전 · 외회전', dose: '', cue: '', video: { youtubeId: '', url: '' } },
    ],
  },
  coaching: {
    id: 'coaching',
    name: '핸드스탠드 온라인 코칭',
    en: 'Handstand Online Coaching',
    period: '7주',
    sub: '7주 과정 · 영상을 보고 따라 한 뒤, 그날의 감각을 체크해 두세요',
    noteLabel: 'Coaching Note',
    noteHint: '각자의 느낌들을 자유롭게 적어 보세요',
    movements: COACHING_MOVEMENTS,
  },
};

/* ════════════════════════════════════════════════════════════
   API (localStorage 어댑터)
   ════════════════════════════════════════════════════════════ */

const api = (() => {
  const KEY = CONFIG.storageKey;
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  };
  const atTime = (day, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
    return d;
  };
  const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  /* 주(월요일 시작) 계산 — 온라인 체크 기록을 주차별로 나눕니다 */
  const weekStartOf = (ts) => {
    const d = new Date(ts);
    const back = (d.getDay() + 6) % 7; // 월=0 … 일=6
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 0, 0, 0, 0);
  };
  const weekKeyOf = (ts) => dayKey(weekStartOf(ts));

  /* 수강생 × 프로그램 × 주차 기록 한 칸 */
  function ensureOnlineRecord(state, studentId, programId, weekKeyValue) {
    if (!state.online) state.online = {};
    if (!state.online[studentId]) state.online[studentId] = {};
    if (!state.online[studentId][programId]) state.online[studentId][programId] = {};
    const bucket = state.online[studentId][programId];
    if (!bucket[weekKeyValue]) bucket[weekKeyValue] = { checks: {}, note: '', updatedAt: null };
    if (!bucket[weekKeyValue].checks) bucket[weekKeyValue].checks = {};
    return bucket[weekKeyValue];
  }

  /* 예약 가능한 수업 목록 (지금부터 N일) */
  function buildSessions(from = new Date(), days = CONFIG.bookingWindowDays) {
    const out = [];
    const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (let i = 0; i < days; i += 1) {
      const day = addDays(base, i);
      const dow = day.getDay();
      CLASSES.forEach((c) => {
        c.slots.forEach((slot) => {
          if (slot.dow !== dow) return;
          const start = atTime(day, slot.start);
          const end = atTime(day, slot.end);
          out.push({
            id: `${c.id}_${dayKey(day)}_${slot.start.replace(':', '')}`,
            classId: c.id,
            className: c.name,
            startISO: start.toISOString(),
            endISO: end.toISOString(),
            start: start.getTime(),
            end: end.getTime(),
          });
        });
      });
    }
    return out.filter((s) => s.end > from.getTime()).sort((a, b) => a.start - b.start);
  }

  function sessionFor(id) {
    return buildSessions(new Date(), 30).find((s) => s.id === id) || null;
  }

  /* 넘어온 희망 수강권을 수업별 객체로 정리
     - { handstand: 8, functional: 1 } 또는 숫자 하나(대상 수업 모두 같은 권종)
     - 빈 값(선택 안 함)은 빼고 돌려줍니다. */
  function parsePassTypes(raw, targetClasses) {
    const out = {};
    if (raw === undefined || raw === null || raw === '' || raw === 'none') return out;
    const typeOf = (value) => {
      const n = Number(value);
      if (!CONFIG.passTypes[n]) throw new Error('수강권 종류를 다시 선택해 주세요.');
      return n;
    };
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      Object.keys(raw).forEach((classId) => {
        const value = raw[classId];
        if (value === undefined || value === null || value === '' || value === 'none') return;
        out[classId] = typeOf(value);
      });
      return out;
    }
    const n = typeOf(raw);
    (targetClasses || []).forEach((classId) => { out[classId] = n; });
    return out;
  }

  /* 수강권 한 장 발급 — 그 수업에 이미 잡혀 있는 예약은 사용 횟수로 계산합니다
     유효기간이 없는 권종(PASS_VALIDITY === null)은 expiresAt: null 로 두어 만료되지 않습니다. */
  function issuePass(student, classId, type, s) {
    const t = CONFIG.passTypes[type];
    if (!t) throw new Error('수강권 종류를 선택해 주세요.');
    assertPassFits([classId], type);
    const upcoming = s.bookings.filter((b) => {
      if (b.studentId !== student.id) return false;
      const session = sessionFor(b.sessionId);
      return !!session && session.classId === classId;
    }).length;
    const now = new Date();
    const days = passValidDays(classId, type);
    if (!student.passes || typeof student.passes !== 'object') student.passes = {};
    student.passes[classId] = {
      type: Number(type),
      total: t.count,
      used: Math.min(upcoming, t.count),
      issuedAt: now.toISOString(),
      expiresAt: days == null ? null : new Date(now.getTime() + days * 86400000).toISOString(),
    };
  }

  /* 최초 실행 시 데모 데이터 */
  function fresh() {
    const now = new Date();
    const iso = (d) => d.toISOString();
    const wk = weekKeyOf(now.getTime());
    const wk1 = weekKeyOf(addDays(now, -7).getTime());
    const wk2 = weekKeyOf(addDays(now, -14).getTime());
    const students = [
      /* 아직 열린 수업도 수강권도 없는 신규 수강생 */
      { id: 'st_new', name: '김하늘', code: 'MJ-1024', passes: {}, classes: [], createdAt: iso(addDays(now, -1)) },
      /* 오프라인 수업별 수강권 · 핸드스탠드 4회권(2회 사용) + 펑셔널 4회권(1회 사용) + 모닝 모빌리티 */
      {
        id: 'st_offline', name: '이서연', code: 'MJ-2048', classes: ['handstand', 'functional', 'morning'],
        passes: {
          handstand: { type: 4, total: 4, used: 2, issuedAt: iso(addDays(now, -10)), expiresAt: iso(addDays(now, 50)) },
          functional: { type: 4, total: 4, used: 1, issuedAt: iso(addDays(now, -10)), expiresAt: iso(addDays(now, 50)) },
        },
        createdAt: iso(addDays(now, -30)),
      },
      /* 모닝 모빌리티만 열린 온라인 수강생 */
      { id: 'st_morning', name: '박지우', code: 'MJ-0812', passes: {}, classes: ['morning'], createdAt: iso(addDays(now, -12)) },
      /* 온라인 코칭 + 모닝 + 핸드스탠드 (핸드스탠드 8회권) — 온라인 탭 두 개 */
      {
        id: 'st_coaching', name: '정민아', code: 'MJ-1125', classes: ['handstand', 'morning', 'coaching'],
        passes: {
          handstand: { type: 8, total: 8, used: 3, issuedAt: iso(addDays(now, -14)), expiresAt: iso(addDays(now, 76)) },
        },
        createdAt: iso(addDays(now, -20)),
      },
      /* 펑셔널 요가만 · 수강권 만료 (이름+코드 로그인으로 확인) */
      {
        id: 'st_expired', name: '최유진', code: 'MJ-0917', classes: ['functional'],
        passes: {
          functional: { type: 4, total: 4, used: 4, issuedAt: iso(addDays(now, -100)), expiresAt: iso(addDays(now, -5)) },
        },
        createdAt: iso(addDays(now, -110)),
      },
    ];
    const state = { version: 3, students, requests: [], bookings: [], notices: demoNotices(now), videos: demoVideos(now) };

    const sessions = buildSessions(now, CONFIG.bookingWindowDays);
    const first = (id) => sessions.find((s) => s.classId === id) || null;
    const seed = (studentId, session) => {
      if (!session) return;
      state.bookings.push({
        id: uid('bk'),
        studentId,
        sessionId: session.id,
        createdAt: iso(addDays(now, -2)),
      });
    };
    const hs = sessions.filter((s) => s.classId === 'handstand');
    seed('st_offline', hs[0]);
    seed('st_offline', first('functional'));
    seed('st_coaching', hs[1] || hs[0]);

    /* 온라인 클래스 샘플 기록 — 이서연(모닝) · 정민아(코칭) */
    state.online = {
      st_offline: {
        morning: {
          [wk2]: {
            checks: {
              mm1: [0, 1, 0, 1, 0, 0, 0],
              mm3: [0, 1, 0, 1, 0, 0, 0],
              mm5: [0, 0, 0, 1, 0, 0, 0],
            },
            note: '첫 주는 어깨가 거의 안 돌아갔는데, 영상 보고 천천히 따라 하니 조금씩 범위가 넓어져요. 무리하지 않고 4회만 채웠습니다.',
            updatedAt: iso(addDays(now, -15)),
          },
          [wk1]: {
            checks: {
              mm1: [1, 0, 1, 0, 1, 0, 0],
              mm2: [1, 0, 0, 0, 1, 0, 0],
              mm3: [1, 1, 0, 1, 0, 0, 0],
              mm6: [0, 0, 1, 0, 1, 0, 0],
            },
            note: '몸통 회전이 오른쪽으로 갈 때 갈비뼈가 걸리는 느낌. 왼쪽은 부드러웠어요.\n아침에 하면 하루 종일 허리가 편합니다.',
            updatedAt: iso(addDays(now, -8)),
          },
          [wk]: {
            checks: {
              mm1: [1, 0, 1, 0, 1, 0, 0],
              mm3: [1, 0, 1, 0, 1, 0, 0],
              mm4: [0, 0, 1, 0, 1, 0, 0],
              mm5: [0, 0, 1, 0, 0, 0, 1],
              mm8: [0, 0, 0, 0, 1, 0, 1],
            },
            note: '어깨가 많이 뻣뻣했는데 3일째 하니 조금 열리는 느낌이에요. 날개뼈 CARs 할 때 왼쪽이 더 걸립니다.',
            updatedAt: iso(addDays(now, -1)),
          },
        },
      },
      st_coaching: {
        coaching: {
          [wk1]: {
            checks: {
              b2: [1, 0, 1, 0, 1, 0, 0],
              b3: [1, 0, 1, 0, 0, 0, 0],
              b6: [0, 0, 1, 0, 1, 0, 0],
            },
            note: '손목 들기 50번을 먼저 하니 벽 아래 홀드가 훨씬 편해졌어요. walking to wall은 3걸음까지 갔습니다.',
            updatedAt: iso(addDays(now, -7)),
          },
          [wk]: {
            checks: {
              b2: [1, 1, 0, 1, 0, 0, 0],
              b3: [1, 1, 0, 1, 0, 0, 0],
              b7: [0, 1, 0, 0, 0, 0, 0],
            },
            note: '벽 아래 홀드 20초가 아직 힘들어요. 손목 들기를 먼저 하고 나면 조금 편합니다.',
            updatedAt: iso(addDays(now, -2)),
          },
        },
      },
    };
    return state;
  }

  /* 강사 화면용: 이번 주 온라인 체크·노트 요약 */
  function onlineSummary(state, weekKeyValue) {
    const records = state.online || {};
    return Object.keys(records)
      .map((studentId) => {
        const student = (state.students || []).find((x) => x.id === studentId);
        if (!student) return null;
        const items = Object.keys(ONLINE)
          .map((programId) => {
            const program = ONLINE[programId];
            const rec = ((records[studentId] || {})[programId] || {})[weekKeyValue];
            if (!rec) return null;
            let checked = 0;
            let count = 0;
            program.movements.forEach((m) => {
              const row = (rec.checks || {})[m.id] || [];
              const hits = row.filter((v) => v === 1).length;
              count += hits;
              if (hits > 0) checked += 1;
            });
            return {
              programId,
              programName: program.name,
              checked,
              total: program.movements.length,
              count,
              note: rec.note || '',
              updatedAt: rec.updatedAt || null,
            };
          })
          .filter(Boolean);
        if (!items.length) return null;
        return { studentId, name: student.name, items };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  /* ── 공지사항 ──────────────────────────────────────────────
     강사가 쓰는 공지. target = 'all'(전체 회원) 또는 수업 id(그 수업을 듣는 회원에게만).
     회원 화면에는 상단 고정(pinned) → 최신순으로 보입니다. */
  const NOTICE_TARGETS = ['all', 'handstand', 'functional', 'morning', 'coaching'];

  function demoNotices(now) {
    const d = (n) => dayKey(addDays(now, n));
    return [
      {
        id: 'nt_demo1',
        title: '12월 수업 시간표를 열었어요',
        body: '12월 첫째 주까지 예약을 열어 두었습니다. 핸드스탠드 무브먼트는 수·목·토·일, 펑셔널 요가는 일요일 오전입니다. 수강권이 있으면 booking에서 바로 날짜를 고를 수 있어요.',
        target: 'all',
        pinned: true,
        createdAt: d(-2),
      },
      {
        id: 'nt_demo2',
        title: '핸드스탠드 무브먼트 — 이번 주 워밍업 안내',
        body: '이번 주는 손목 풀기와 어깨 정렬 워밍업을 15분으로 늘립니다. 수업 10분 전에 도착해 손목을 미리 풀어 두면 킥업이 훨씬 편해요. 손목이 불편하면 벽 아래 홀드부터 시작합니다.',
        target: 'handstand',
        pinned: false,
        createdAt: d(-1),
      },
    ];
  }

  /* ── 코칭 영상 ──────────────────────────────────────────────
     핸드스탠드 온라인 코칭 수강생이 올린 개인 영상입니다.
     영상 파일(Blob)은 app.js가 IndexedDB(mijeong_video_db)에 두고,
     여기에는 제목 · 주차 · 메모 · 파일 정보 · 링크 · 강사 코멘트만 남깁니다.
     (실운영에서는 videos 테이블 + 스토리지 업로드로 바뀝니다) */
  const VIDEO_PROGRAM = 'coaching';
  const VIDEO_TITLE_MAX = 60;
  const VIDEO_NOTE_MAX = 500;
  const VIDEO_COMMENT_MAX = 600;
  const VIDEO_LINK_MAX = 500;

  /* 시안용 예시 — 정민아(코칭 데모 수강생)의 영상 2건 (코멘트 완료 1 · 피드백 대기 1) */
  function demoVideos(now) {
    const iso = (d) => d.toISOString();
    return [
      {
        id: 'cv_demo1',
        studentId: 'st_coaching',
        programId: VIDEO_PROGRAM,
        title: '벽 10초 홀드 연습',
        weekKey: weekKeyOf(addDays(now, -7).getTime()),
        note: '어깨가 자꾸 꺾이는 느낌이에요. 벽에서 발을 떼면 2초쯤 버티다가 내려옵니다.',
        fileName: '벽홀드-연습.mp4',
        fileSize: 2458624,
        fileType: 'video/mp4',
        link: '',
        demoFile: 'assets/coaching-sample.mp4',
        createdAt: iso(addDays(now, -6)),
        status: 'done',
        comment: '벽 홀드 자세 좋아요. 손목이 조금 뒤로 넘어가니 손가락 뿌리를 바닥으로 눌러 주세요. 다음 주에는 벽에서 발을 떼고 3초를 목표로 해 봅시다.',
        commentAt: iso(addDays(now, -5)),
      },
      {
        id: 'cv_demo2',
        studentId: 'st_coaching',
        programId: VIDEO_PROGRAM,
        title: '손목 들기 20회 + walking to wall',
        weekKey: weekKeyOf(now.getTime()),
        note: '이번 주는 손목이 덜 아팠어요. walking to wall 3걸음까지 갔습니다.',
        fileName: 'walking-to-wall.mp4',
        fileSize: 1883136,
        fileType: 'video/mp4',
        link: '',
        demoFile: 'assets/coaching-sample.mp4',
        createdAt: iso(addDays(now, -1)),
        status: 'pending',
        comment: '',
        commentAt: null,
      },
    ];
  }

  /* 저장된 영상 한 건을 화면이 기대하는 모양으로 맞춥니다 */
  function normalizeVideo(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    return {
      id: String(raw.id),
      studentId: String(raw.studentId || ''),
      programId: String(raw.programId || VIDEO_PROGRAM),
      title: String(raw.title || ''),
      weekKey: String(raw.weekKey || ''),
      note: String(raw.note || ''),
      fileName: String(raw.fileName || ''),
      fileSize: Number(raw.fileSize) > 0 ? Math.round(Number(raw.fileSize)) : 0,
      fileType: String(raw.fileType || ''),
      link: String(raw.link || ''),
      demoFile: String(raw.demoFile || ''),
      createdAt: String(raw.createdAt || ''),
      status: raw.status === 'done' ? 'done' : 'pending',
      comment: String(raw.comment || ''),
      commentAt: raw.commentAt ? String(raw.commentAt) : null,
    };
  }

  /* 코칭 영상 목록 — 최신순, 수강생 이름을 붙여 강사 화면에서도 씁니다 */
  function videoRows(state) {
    return (state.videos || [])
      .map(normalizeVideo)
      .filter((v) => v && v.programId === VIDEO_PROGRAM)
      .map((v) => {
        const student = (state.students || []).find((x) => x.id === v.studentId);
        if (!student) return null;
        return { ...v, studentName: student.name, studentCode: student.code };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return String(a.createdAt) < String(b.createdAt) ? 1 : -1;
        return String(a.id) < String(b.id) ? 1 : -1;
      });
  }

  function videoLinkValue(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    if (text.length > VIDEO_LINK_MAX) throw new Error(`영상 링크는 ${VIDEO_LINK_MAX}자까지 넣을 수 있어요.`);
    if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(text)) {
      throw new Error('영상 링크는 http:// 또는 https://로 시작하는 주소를 넣어 주세요.');
    }
    return text;
  }

  function toBool(value) {
    return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
  }

  function cleanNoticeText(value, label, max) {
    const text = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
    if (!text) throw new Error(`${label}을 입력해 주세요.`);
    if (text.length > max) throw new Error(`${label}은 ${max}자까지 쓸 수 있어요.`);
    return text;
  }

  function normalizeTarget(target) {
    const t = String(target == null ? '' : target).trim();
    if (NOTICE_TARGETS.indexOf(t) === -1) throw new Error('공지 대상을 전체 회원 또는 수업으로 골라 주세요.');
    return t;
  }

  function noticeSort(a, b) {
    if (!!a.pinned !== !!b.pinned) return b.pinned ? 1 : -1;
    if (a.createdAt !== b.createdAt) return String(a.createdAt) < String(b.createdAt) ? 1 : -1;
    return String(a.id) < String(b.id) ? 1 : -1;
  }

  function normalizeNotice(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: String(raw.id || uid('nt')),
      title: String(raw.title || '').trim(),
      body: String(raw.body || '').trim(),
      target: NOTICE_TARGETS.indexOf(raw.target) === -1 ? 'all' : raw.target,
      pinned: !!raw.pinned,
      createdAt: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.createdAt || '')) ? raw.createdAt : dayKey(new Date()),
    };
  }

  /* 그 수강생이 볼 공지 — 전체 공지 + 수강 중인 수업 공지 */
  function noticesForStudent(student) {
    const classes = normalizeClasses(student && student.classes);
    return (state.notices || [])
      .map(normalizeNotice)
      .filter((n) => n && n.title && (n.target === 'all' || classes.indexOf(n.target) !== -1))
      .sort(noticeSort);
  }

  let state = null;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[mj] 저장 실패', err);
    }
  }

  function load() {
    if (state) return state;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = JSON.parse(raw);
    } catch (err) {
      state = null;
    }
    /* 수업별 접근 제어 이전 데이터는 새 데모 구성으로 다시 시작합니다 (version 3) */
    if (!state || state.version !== 3) {
      state = fresh();
      save();
      return state;
    }
    /* 온라인 체크 기능 이전에 저장된 데이터 보정 */
    if (!state.online) {
      state.online = {};
      save();
    }
    /* 공지사항 이전에 저장된 데이터에는 데모 공지를 한 번 넣어 둡니다.
       강사가 모두 지우면 빈 배열로 남아 다시 채우지 않습니다. */
    if (!Array.isArray(state.notices)) {
      state.notices = demoNotices(new Date());
      save();
    }
    /* 코칭 영상 기능 이전 데이터에도 예시 영상 2건을 한 번 넣어 둡니다.
       수강생이 모두 지우면 빈 배열로 남아 다시 채우지 않습니다. */
    if (!Array.isArray(state.videos)) {
      state.videos = demoVideos(new Date());
      save();
    }
    migrateClasses();
    migratePasses();
    prune();
    return state;
  }

  /* 수업별 접근 제어 이전 데이터 보정
     - 예전 프로그램 키 online-coaching → coaching
     - classes 속성이 없으면 수강권(오프라인)과 온라인 기록으로 추정 */
  function migrateClasses() {
    let changed = false;

    if (state.online) {
      Object.keys(state.online).forEach((studentId) => {
        const bucket = state.online[studentId];
        if (!bucket || typeof bucket !== 'object') return;
        if (bucket['online-coaching']) {
          if (!bucket.coaching) bucket.coaching = bucket['online-coaching'];
          delete bucket['online-coaching'];
          changed = true;
        }
      });
    }

    (state.students || []).forEach((student) => {
      if (Array.isArray(student.classes)) {
        const normalized = normalizeClasses(student.classes);
        if (normalized.length !== student.classes.length) {
          student.classes = normalized;
          changed = true;
        }
        return;
      }
      const programs = Object.keys((state.online && state.online[student.id]) || {});
      const hasPass = !!student.pass || (student.passes && Object.keys(student.passes).length > 0);
      const guessed = (hasPass ? OFFLINE_CLASS_IDS.slice() : []).concat(programs);
      student.classes = normalizeClasses(guessed);
      changed = true;
    });

    if (changed) save();
  }

  /* 수업별 수강권 이전 데이터 보정 (단일 pass → passes)
     - 예전에는 수강생당 수강권 한 장이었습니다. 그 수강권을 첫 번째 오프라인 수강권으로 옮기고,
       나머지 오프라인 수업에는 같은 권종·같은 유효기간의 새 수강권을 붙입니다(사용 0회).
     - 신청서의 희망 수강권(passType)도 수업별(passTypes)로 나뉩니다. */
  function migratePasses() {
    let changed = false;
    const at = Date.now();

    (state.students || []).forEach((student) => {
      let hasMap = student.passes && typeof student.passes === 'object' && !Array.isArray(student.passes);
      if (!hasMap || student.pass) {
        const offline = offlineOf(normalizeClasses(student.classes));
        const legacy = student.pass && CONFIG.passTypes[student.pass.type] ? student.pass : null;
        const next = hasMap ? { ...student.passes } : {};
        if (legacy && offline.length) {
          offline.forEach((classId, index) => {
            if (next[classId]) return;
            next[classId] = {
              type: Number(legacy.type),
              total: Number(legacy.total) || CONFIG.passTypes[legacy.type].count,
              used: index === 0 ? Math.max(0, Number(legacy.used) || 0) : 0,
              issuedAt: legacy.issuedAt || new Date(at).toISOString(),
              expiresAt: legacy.expiresAt || null,
            };
          });
        }
        student.passes = next;
        if (student.pass) delete student.pass;
        changed = true;
      }

      /* 수강권 숫자·유효기간 형태 정리 */
      Object.keys(student.passes || {}).forEach((classId) => {
        const p = student.passes[classId];
        if (!p || typeof p !== 'object') {
          delete student.passes[classId];
          changed = true;
          return;
        }
        const type = Number(p.type);
        if (!CONFIG.passTypes[type]) {
          delete student.passes[classId];
          changed = true;
          return;
        }
        const total = Number(p.total) || CONFIG.passTypes[type].count;
        const used = Math.max(0, Number(p.used) || 0);
        const expiresAt = p.expiresAt === undefined ? null : p.expiresAt;
        if (p.type !== type || p.total !== total || p.used !== used || p.expiresAt !== expiresAt) {
          student.passes[classId] = { ...p, type, total, used, expiresAt };
          changed = true;
        }
      });
    });

    /* 신청서의 희망 수강권도 수업별로 */
    (state.requests || []).forEach((req) => {
      if (req.passTypes && typeof req.passTypes === 'object' && !Array.isArray(req.passTypes)) {
        if (req.passType !== undefined) {
          delete req.passType;
          changed = true;
        }
        return;
      }
      if (req.passType == null) return;
      const type = Number(req.passType);
      const map = {};
      offlineOf(normalizeClasses(req.classes)).forEach((classId) => {
        if (passPriceOf(classId, type) != null) map[classId] = type;
      });
      req.passTypes = map;
      delete req.passType;
      changed = true;
    });

    if (changed) save();
  }

  /* 지난 예약은 목록에서 정리 (수강권 used 값은 그대로 둡니다) */
  function prune() {
    const live = new Set(buildSessions(new Date(), 30).map((s) => s.id));
    const before = state.bookings.length;
    state.bookings = state.bookings.filter((b) => live.has(b.sessionId));
    if (state.bookings.length !== before) save();
  }

  function statusOf(student) {
    const pending = state.requests.find((r) => r.studentId === student.id && r.status === 'pending');
    const offline = offlineOf(normalizeClasses(student.classes));
    const passes = offline.map((id) => student.passes && student.passes[id]).filter(Boolean);
    if (!passes.length) return { status: pending ? 'pending' : 'new', pending: pending || null };
    /* 한 수업이라도 예약할 수 있는 수강권이 살아 있으면 사용 중 */
    if (passes.some((p) => passIsActive(p))) return { status: 'active', pending: pending || null };
    return { status: pending ? 'pending' : 'exhausted', pending: pending || null };
  }

  /* 앱이 쓰는 수강생 뷰 (계산된 값 포함) */
  function viewStudent(id) {
    const s = load();
    const student = s.students.find((x) => x.id === id);
    if (!student) return null;
    const access = accessFor(student);
    const { status, pending } = statusOf(student);
    const sessions = new Map(buildSessions(new Date(), 30).map((x) => [x.id, x]));
    const bookings = s.bookings
      .filter((b) => b.studentId === id)
      .map((b) => {
        const session = sessions.get(b.sessionId);
        if (!session) return null;
        return {
          id: b.id,
          sessionId: b.sessionId,
          classId: session.classId,
          className: session.className,
          startISO: session.startISO,
          endISO: session.endISO,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.startISO) - new Date(b.startISO));

    let pass = null;
    const passes = {};
    access.offline.forEach((classId) => {
      const pv = passView(student.passes && student.passes[classId], classId);
      if (pv) passes[classId] = pv;
    });
    /* 예전 화면과의 호환: 대표 수강권 한 장 (첫 오프라인 수업의 수강권) */
    const firstPassId = Object.keys(passes)[0];
    if (firstPassId) pass = passes[firstPassId];

    /* 예약 건수는 수업별로도 셀 수 있게 함께 넘깁니다 */
    const bookingsByClass = {};
    bookings.forEach((b) => {
      bookingsByClass[b.classId] = (bookingsByClass[b.classId] || 0) + 1;
    });

    return {
      id: student.id,
      name: student.name,
      code: student.code,
      status,
      pending: pending
        ? {
          id: pending.id,
          type: pending.type,
          createdAt: pending.createdAt,
          classes: normalizeClasses(pending.classes),
          passTypes: pendingPassTypes(pending),
        }
        : null,
      pass,
      passes,
      bookings,
      bookingsByClass,
      classes: access.classes,
      access,
      /* 이 수강생에게 보이는 공지 (전체 + 수강 중인 수업) */
      notices: noticesForStudent(student),
    };
  }

  /* 신청서의 희망 수강권 — 수업별 객체 (예전 단일 passType 데이터도 읽습니다) */
  function pendingPassTypes(request) {
    const out = {};
    const raw = request && request.passTypes;
    if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach((classId) => {
        const n = Number(raw[classId]);
        if (CONFIG.passTypes[n]) out[classId] = n;
      });
      return out;
    }
    const legacy = request && request.passType;
    if (legacy == null || legacy === '') return out;
    const n = Number(legacy);
    offlineOf(normalizeClasses(request.classes)).forEach((classId) => {
      if (CONFIG.passTypes[n] && passPriceOf(classId, n) != null) out[classId] = n;
    });
    return out;
  }

  return {
    CONFIG,

    /* ── 조회 ── */
    async listSessions(days = CONFIG.bookingWindowDays) {
      load();
      return buildSessions(new Date(), days).map((s) => ({
        id: s.id, classId: s.classId, className: s.className,
        startISO: s.startISO, endISO: s.endISO,
      }));
    },

    async getStudent(id) {
      return viewStudent(id);
    },

    async login({ name, code }) {
      const s = load();
      const n = String(name || '').trim();
      const c = String(code || '').trim().toUpperCase();
      const student = s.students.find(
        (x) => x.name === n && String(x.code).toUpperCase() === c,
      );
      if (!student) throw new Error('이름과 수강 코드를 다시 확인해 주세요.');
      return viewStudent(student.id);
    },

    /* ── 예약 ── */
    /* byInstructor: true 로 부르면 강사 모드의 대리 예약 (규칙은 수강생 예약과 같습니다) */
    async book(studentId, sessionId, options = {}) {
      const s = load();
      const byInstructor = !!(options && options.byInstructor);
      const student = s.students.find((x) => x.id === studentId);
      if (!student) throw new Error('수강생 정보를 찾을 수 없어요.');

      const v = viewStudent(studentId);
      const session = sessionFor(sessionId);
      if (!session) throw new Error('예약할 수 없는 시간이에요.');
      if (v.classes.indexOf(session.classId) === -1) {
        throw new Error('수강 중인 수업만 예약할 수 있어요.');
      }
      /* 그 수업의 수강권만 봅니다 — 다른 수업 수강권으로는 예약할 수 없습니다 */
      const classPass = v.passes[session.classId];
      if (!classPass || !classPass.active) {
        throw new Error(`${session.className} 수강권이 없거나 기간이 지났어요.`);
      }
      if (session.start <= Date.now()) throw new Error('이미 시작한 수업이에요.');

      if (s.bookings.some((b) => b.studentId === studentId && b.sessionId === sessionId)) {
        throw new Error('이미 예약한 수업이에요.');
      }

      /* 같은 시간대 중복 예약 방지 */
      const sessionMap = new Map(buildSessions(new Date(), 30).map((x) => [x.id, x]));
      const clash = s.bookings
        .filter((b) => b.studentId === studentId)
        .some((b) => {
          const other = sessionMap.get(b.sessionId);
          return other && other.start < session.end && session.start < other.end;
        });
      if (clash) throw new Error('같은 시간에 이미 예약한 수업이 있어요.');

      s.bookings.push({
        id: uid('bk'),
        studentId,
        sessionId,
        by: byInstructor ? 'instructor' : 'student',
        createdAt: new Date().toISOString(),
      });
      /* 그 수업의 수강권에서만 1회 차감 */
      student.passes[session.classId].used = Number(student.passes[session.classId].used || 0) + 1;
      save();
      return viewStudent(studentId);
    },

    /* 취소 가능 시각 = 수업 시작 1시간 전 */
    cancelDeadline(session) {
      return new Date(new Date(session.startISO).getTime() - CONFIG.cancelDeadlineMs);
    },

    /* byInstructor: true 면 1시간 전 마감과 무관하게 취소 (강사 대리 취소) */
    async cancel(studentId, bookingId, options = {}) {
      const s = load();
      const byInstructor = !!(options && options.byInstructor);
      const booking = s.bookings.find((b) => b.id === bookingId && b.studentId === studentId);
      if (!booking) throw new Error('예약을 찾을 수 없어요.');

      const session = sessionFor(booking.sessionId);
      if (!session) throw new Error('이미 지난 수업이에요.');
      if (byInstructor) {
        /* 강사는 마감과 무관하게 취소할 수 있고, 횟수도 그대로 돌려줍니다 */
        if (session.end <= Date.now()) throw new Error('이미 끝난 수업이에요.');
      } else if (Date.now() > this.cancelDeadline(session).getTime()) {
        throw new Error('취소 마감 시간이 지났어요. (수업 시작 1시간 전까지)');
      }

      s.bookings = s.bookings.filter((b) => b.id !== bookingId);
      const student = s.students.find((x) => x.id === studentId);
      const classPass = student && student.passes ? student.passes[session.classId] : null;
      if (classPass) classPass.used = Math.max(0, Number(classPass.used || 0) - 1);
      save();
      return viewStudent(studentId);
    },

    /* ── 강사 대리 예약 / 대리 취소 ── */
    async adminBook(studentId, sessionId) {
      return this.book(studentId, sessionId, { byInstructor: true });
    },

    async adminCancel(bookingId) {
      const s = load();
      const booking = s.bookings.find((b) => b.id === bookingId);
      if (!booking) throw new Error('예약을 찾을 수 없어요.');
      return this.cancel(booking.studentId, bookingId, { byInstructor: true });
    },

    /* ── 신규 등록 / 재등록 요청 ── */
    /* classes: 수강을 원하는 수업(최소 1개, 여러 개 가능). 강사가 승인할 때 그대로 열어 줍니다.
       options.passTypes: 수업별 희망 수강권 { handstand: 8, functional: 1 }.
         숫자 하나만 주면 그 수업들 모두에 같은 권종으로 신청합니다(예전 방식).
       허용된 수업을 하나도 고르지 않으면 신청 자체를 막습니다. */
    async request(studentId, type, classes, options = {}) {
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) throw new Error('수강생 정보를 찾을 수 없어요.');
      if (s.requests.some((r) => r.studentId === studentId && r.status === 'pending')) {
        throw new Error('이미 확인 중인 요청이 있어요.');
      }

      const picked = normalizeClasses(Array.isArray(classes) ? classes : student.classes);
      if (!picked.length) throw new Error('수업을 하나 이상 선택해 주세요.');

      const offlinePicked = offlineOf(picked);
      const raw = options && options.passTypes !== undefined ? options.passTypes : (options && options.passType);
      const passTypes = parsePassTypes(raw, offlinePicked);
      Object.keys(passTypes).forEach((classId) => {
        if (offlinePicked.indexOf(classId) === -1) {
          throw new Error('수강권은 오프라인 수업에만 고를 수 있어요.');
        }
        /* 그 수업에 없는 권종(예: 핸드스탠드에 1회권)은 막습니다 */
        assertPassFits([classId], passTypes[classId]);
      });
      /* 오프라인 수업은 수강권을 골라야 신청됩니다 (이미 살아 있는 수강권이 있으면 그대로 둡니다) */
      const active = activeOfflineOf(student);
      offlinePicked.forEach((classId) => {
        if (!passTypes[classId] && active.indexOf(classId) === -1) {
          throw new Error(`${classNameOf(classId)} 수강권을 골라 주세요.`);
        }
      });

      const request = {
        id: uid('rq'),
        studentId,
        type, // 'register' | 'renewal'
        classes: picked,
        passTypes,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      s.requests.push(request);
      save();
      return viewStudent(studentId);
    },

    /* ── 강사: 수강권 부여 / 요청 승인 ── */
    /* type: 수업별 수강권 { handstand: 8, functional: 1 } 또는 숫자 하나(열린 오프라인 수업 전체).
       classes 를 주면 그 수업으로 접근 권한도 함께 바뀝니다. */
    async grantPass(studentId, type, classes) {
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) throw new Error('수강생을 찾을 수 없어요.');
      const next = Array.isArray(classes) ? normalizeClasses(classes) : normalizeClasses(student.classes);
      const offline = offlineOf(next);

      let types = {};
      if (type && typeof type === 'object' && !Array.isArray(type)) {
        types = parsePassTypes(type, offline);
        Object.keys(types).forEach((classId) => {
          if (offline.indexOf(classId) === -1) {
            throw new Error('열린 오프라인 수업의 수강권만 부여할 수 있어요.');
          }
          assertPassFits([classId], types[classId]);
        });
      } else if (type !== undefined && type !== null && type !== '') {
        const n = Number(type);
        if (!CONFIG.passTypes[n]) throw new Error('수강권 종류를 선택해 주세요.');
        if (!offline.length) throw new Error('오프라인 수업을 먼저 열어 주세요.');
        assertPassFits(offline, n);
        offline.forEach((classId) => { types[classId] = n; });
      }
      if (!Object.keys(types).length) throw new Error('수강권 종류를 선택해 주세요.');

      if (Array.isArray(classes)) student.classes = next;
      else if (!Array.isArray(student.classes)) student.classes = offline.slice();

      Object.keys(types).forEach((classId) => issuePass(student, classId, types[classId], s));

      const now = new Date();
      s.requests
        .filter((r) => r.studentId === studentId && r.status === 'pending')
        .forEach((r) => {
          r.status = 'approved';
          r.resolvedAt = now.toISOString();
        });
      save();
      return viewStudent(studentId);
    },

    /* 승인 — 신청한 수업을 한 번에 엽니다.
       이미 열려 있던 수업은 그대로 두고 신청한 수업을 더합니다.
       passTypes 가 비어 있으면 수강권 없이 수업만 엽니다(온라인 전용 신청). */
    async approveRequest(requestId, passTypes, classes) {
      const s = load();
      const req = s.requests.find((r) => r.id === requestId);
      if (!req) throw new Error('요청을 찾을 수 없어요.');
      if (req.status !== 'pending') throw new Error('이미 처리된 요청이에요.');
      const student = s.students.find((x) => x.id === req.studentId);
      if (!student) throw new Error('수강생을 찾을 수 없어요.');

      const picked = normalizeClasses(Array.isArray(classes) ? classes : req.classes);
      if (!picked.length) throw new Error('수업을 하나 이상 선택해 주세요.');
      const merged = normalizeClasses((student.classes || []).concat(picked));
      const offlinePicked = offlineOf(picked);

      const raw = passTypes === undefined ? pendingPassTypes(req) : passTypes;
      const types = parsePassTypes(raw, offlinePicked);
      Object.keys(types).forEach((classId) => {
        if (offlinePicked.indexOf(classId) === -1) {
          throw new Error('수강권은 오프라인 수업에만 고를 수 있어요.');
        }
        assertPassFits([classId], types[classId]);
      });
      const active = activeOfflineOf(student);
      offlinePicked.forEach((classId) => {
        if (!types[classId] && active.indexOf(classId) === -1) {
          throw new Error('오프라인 수업을 열려면 수강권을 골라 주세요.');
        }
      });

      student.classes = merged;
      Object.keys(types).forEach((classId) => issuePass(student, classId, types[classId], s));

      const now = new Date().toISOString();
      s.requests
        .filter((r) => r.studentId === student.id && r.status === 'pending')
        .forEach((r) => {
          r.status = 'approved';
          r.resolvedAt = now;
        });
      save();
      return viewStudent(student.id);
    },

    /* ── 강사: 회원 등록 · 수업 접근 관리 ── */
    async adminRegister({ name, code, classes, passType, passTypes } = {}) {
      const s = load();
      const n = String(name || '').trim();
      const c = String(code || '').trim().toUpperCase();
      if (n.length < 1) throw new Error('이름을 입력해 주세요.');
      if (!/^[A-Z0-9-]{4,12}$/.test(c)) throw new Error('수강 코드는 영문·숫자 4~12자로 입력해 주세요.');
      if (s.students.some((x) => String(x.code).toUpperCase() === c)) {
        throw new Error('이미 사용 중인 수강 코드예요.');
      }
      const student = {
        id: uid('st'),
        name: n,
        code: c,
        classes: normalizeClasses(classes),
        passes: {},
        createdAt: new Date().toISOString(),
      };
      s.students.push(student);
      save();
      const raw = passTypes !== undefined ? passTypes : passType;
      const types = parsePassTypes(raw, offlineOf(student.classes));
      if (Object.keys(types).length) return this.grantPass(student.id, types, student.classes);
      return viewStudent(student.id);
    },

    async adminSetClasses(studentId, classes) {
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) throw new Error('수강생을 찾을 수 없어요.');
      student.classes = normalizeClasses(classes);
      save();
      return viewStudent(studentId);
    },

    /* 수강생이 볼 수 있는 범위 (앱의 섹션 표시 판단용) */
    async accessOf(studentId) {
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) return null;
      return accessFor(student);
    },

    /* ── 공지사항 ── */
    async listNotices(studentId) {
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) return [];
      return noticesForStudent(student);
    },

    /* 강사: 공지 작성 — { title, body, target, pinned } */
    async addNotice(fields) {
      const s = load();
      if (!Array.isArray(s.notices)) s.notices = [];
      const src = fields || {};
      const notice = {
        id: uid('nt'),
        title: cleanNoticeText(src.title, '공지 제목', 80),
        body: cleanNoticeText(src.body, '공지 내용', 1200),
        target: normalizeTarget(src.target === undefined ? 'all' : src.target),
        pinned: toBool(src.pinned),
        createdAt: dayKey(new Date()),
      };
      s.notices.push(notice);
      save();
      return { ...notice };
    },

    /* 강사: 공지 수정 — 넘긴 항목만 바뀝니다 */
    async updateNotice(id, fields) {
      const s = load();
      const notice = (s.notices || []).find((n) => n && n.id === id);
      if (!notice) throw new Error('공지를 찾을 수 없어요.');
      const src = fields || {};
      if (src.title !== undefined) notice.title = cleanNoticeText(src.title, '공지 제목', 80);
      if (src.body !== undefined) notice.body = cleanNoticeText(src.body, '공지 내용', 1200);
      if (src.target !== undefined) notice.target = normalizeTarget(src.target);
      if (src.pinned !== undefined) notice.pinned = toBool(src.pinned);
      save();
      return { ...notice };
    },

    /* 강사: 공지 삭제 */
    async deleteNotice(id) {
      const s = load();
      const before = (s.notices || []).length;
      s.notices = (s.notices || []).filter((n) => n && n.id !== id);
      if (s.notices.length === before) throw new Error('공지를 찾을 수 없어요.');
      save();
      return true;
    },

    /* 공지 대상으로 고를 수 있는 값 */
    noticeTargets() {
      return NOTICE_TARGETS.slice();
    },

    /* ── 온라인 클래스: 주간 체크 & 노트 ── */
    async getOnline(studentId) {
      const s = load();
      const all = (s.online && s.online[studentId]) || {};
      return JSON.parse(JSON.stringify(all));
    },

    /* 주 시작일 키 (기본: 이번 주) */
    weekKey(ts) {
      return weekKeyOf(ts == null ? Date.now() : ts);
    },

    async setOnlineCheck(studentId, programId, weekKeyValue, movementId, dayIndex, on) {
      if (!studentId) throw new Error('로그인한 수강생만 체크할 수 있어요.');
      const program = ONLINE[programId];
      if (!program) throw new Error('온라인 클래스를 찾을 수 없어요.');
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) throw new Error('수강생 정보를 찾을 수 없어요.');
      if (accessFor(student).online.indexOf(programId) === -1) {
        throw new Error('수강 중인 온라인 클래스만 기록할 수 있어요.');
      }
      if (!weekKeyValue) throw new Error('주차를 다시 선택해 주세요.');
      const day = Number(dayIndex);
      if (!(day >= 0 && day <= 6)) throw new Error('요일을 다시 확인해 주세요.');
      if (!program.movements.some((m) => m.id === movementId)) {
        throw new Error('동작을 찾을 수 없어요.');
      }

      const rec = ensureOnlineRecord(s, studentId, programId, weekKeyValue);
      if (!rec.checks[movementId]) rec.checks[movementId] = [0, 0, 0, 0, 0, 0, 0];
      rec.checks[movementId][day] = on ? 1 : 0;
      rec.updatedAt = new Date().toISOString();
      save();
      return JSON.parse(JSON.stringify(rec));
    },

    async setOnlineNote(studentId, programId, weekKeyValue, text) {
      if (!studentId) throw new Error('로그인한 수강생만 노트를 저장할 수 있어요.');
      if (!ONLINE[programId]) throw new Error('온라인 클래스를 찾을 수 없어요.');
      if (!weekKeyValue) throw new Error('주차를 다시 선택해 주세요.');
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) throw new Error('수강생 정보를 찾을 수 없어요.');
      if (accessFor(student).online.indexOf(programId) === -1) {
        throw new Error('수강 중인 온라인 클래스만 기록할 수 있어요.');
      }
      const rec = ensureOnlineRecord(s, studentId, programId, weekKeyValue);
      rec.note = String(text == null ? '' : text).slice(0, 2000);
      rec.updatedAt = new Date().toISOString();
      save();
      return JSON.parse(JSON.stringify(rec));
    },

    /* ── 코칭 영상: 수강생 업로드 · 조회 · 삭제 ── */
    async listVideos(studentId) {
      const s = load();
      if (!studentId) return [];
      return videoRows(s).filter((v) => v.studentId === studentId);
    },

    /* file: { name, size, type } — 실제 Blob은 app.js가 IndexedDB에 저장합니다 */
    async addVideo(studentId, input = {}) {
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) throw new Error('수강생 정보를 찾을 수 없어요.');
      if (accessFor(student).online.indexOf(VIDEO_PROGRAM) === -1) {
        throw new Error('핸드스탠드 온라인 코칭을 듣는 수강생만 영상을 올릴 수 있어요.');
      }

      const title = String(input.title == null ? '' : input.title).replace(/\r\n/g, '\n').trim();
      if (!title) throw new Error('영상 제목을 입력해 주세요.');
      if (title.length > VIDEO_TITLE_MAX) throw new Error(`영상 제목은 ${VIDEO_TITLE_MAX}자까지 쓸 수 있어요.`);

      const weekKeyValue = String(input.weekKey || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKeyValue)) throw new Error('주차를 다시 선택해 주세요.');

      const note = String(input.note == null ? '' : input.note).replace(/\r\n/g, '\n').trim();
      if (note.length > VIDEO_NOTE_MAX) throw new Error(`수강생 메모는 ${VIDEO_NOTE_MAX}자까지 쓸 수 있어요.`);

      const link = videoLinkValue(input.link);
      const file = input.file || null;
      const fileName = file && file.name ? String(file.name).slice(0, 120) : '';
      const fileSize = file && Number(file.size) > 0 ? Math.round(Number(file.size)) : 0;
      const fileType = file && file.type ? String(file.type) : '';
      if (!fileName && !link) throw new Error('영상 파일이나 영상 링크 중 하나는 있어야 해요.');

      if (!Array.isArray(s.videos)) s.videos = [];
      const video = {
        id: uid('cv'),
        studentId,
        programId: VIDEO_PROGRAM,
        title,
        weekKey: weekKeyValue,
        note,
        fileName,
        fileSize,
        fileType,
        link,
        demoFile: '',
        createdAt: new Date().toISOString(),
        status: 'pending',
        comment: '',
        commentAt: null,
      };
      s.videos.push(video);
      save();
      return normalizeVideo(video);
    },

    async deleteVideo(studentId, videoId) {
      const s = load();
      const list = s.videos || [];
      const hit = list.find((v) => v && v.id === videoId && (!studentId || v.studentId === studentId));
      if (!hit) throw new Error('코칭 영상을 찾을 수 없어요.');
      s.videos = list.filter((v) => v.id !== videoId);
      save();
      return true;
    },

    /* ── 강사: 코칭 코멘트 저장 (다시 저장하면 수정) ── */
    async addVideoComment(videoId, text) {
      const s = load();
      const video = (s.videos || []).find((v) => v && v.id === videoId);
      if (!video) throw new Error('코칭 영상을 찾을 수 없어요.');
      const comment = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
      if (!comment) throw new Error('피드백 코멘트를 입력해 주세요.');
      if (comment.length > VIDEO_COMMENT_MAX) {
        throw new Error(`피드백 코멘트는 ${VIDEO_COMMENT_MAX}자까지 쓸 수 있어요.`);
      }
      video.comment = comment;
      video.commentAt = new Date().toISOString();
      video.status = 'done';
      save();
      return normalizeVideo(video);
    },

    /* ── 강사 화면 데이터 ── */
    async adminData() {
      const s = load();
      const now = Date.now();
      const sessions = buildSessions(new Date(), CONFIG.bookingWindowDays);
      const students = s.students.map((st) => {
        const v = viewStudent(st.id);
        return {
          id: v.id, name: v.name, code: v.code, status: v.status,
          pass: v.pass, passes: v.passes, classes: v.classes,
        };
      });
      const nameOf = new Map(students.map((st) => [st.id, st]));
      const videos = videoRows(s);

      const byDay = new Map();
      sessions.forEach((session) => {
        const key = dayKey(new Date(session.startISO));
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push({
          id: session.id,
          classId: session.classId,
          className: session.className,
          startISO: session.startISO,
          endISO: session.endISO,
          startMs: session.start,
          /* 수강생이 스스로 취소할 수 있는 시각이 지났는지 */
          late: now > session.start - CONFIG.cancelDeadlineMs,
          /* 아직 시작하지 않은 수업만 새로 예약할 수 있습니다 */
          bookable: session.start > now,
          bookings: s.bookings
            .filter((b) => b.sessionId === session.id)
            .map((b) => {
              const st = s.students.find((x) => x.id === b.studentId);
              const info = nameOf.get(b.studentId) || null;
              return {
                id: b.id,
                studentId: b.studentId,
                name: st ? st.name : '—',
                by: b.by === 'instructor' ? 'instructor' : 'student',
                passLabel: info && info.passes[session.classId] ? info.passes[session.classId].label : '',
              };
            }),
        });
      });

      return {
        now,
        students,
        notices: (s.notices || []).map(normalizeNotice).filter(Boolean).sort(noticeSort),
        roster: CLASS_ORDER.map((id) => {
          const cls = CLASSES.find((c) => c.id === id) || { id, name: id, mode: 'online' };
          return { id, name: cls.name, mode: cls.mode };
        }),
        online: onlineSummary(s, weekKeyOf(now)),
        onlineWeekKey: weekKeyOf(now),
        videos,
        videoPending: videos.filter((v) => v.status !== 'done').length,
        pending: s.requests
          .filter((r) => r.status === 'pending')
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .map((r) => {
            const st = s.students.find((x) => x.id === r.studentId);
            const reqClasses = normalizeClasses(r.classes || (st && st.classes));
            return {
              id: r.id,
              type: r.type,
              createdAt: r.createdAt,
              studentId: r.studentId,
              studentName: st ? st.name : '—',
              studentCode: st ? st.code : '',
              classes: reqClasses,
              passTypes: pendingPassTypes(r),
              /* 이미 열려 있는 수업 (승인하면 여기에 신청 수업이 더해집니다) */
              currentClasses: normalizeClasses(st && st.classes),
              offline: offlineOf(reqClasses).length,
              online: onlineOf(reqClasses).length,
            };
          }),
        days: Array.from(byDay.entries()).map(([key, list]) => ({
          key,
          startISO: list[0].startISO,
          sessions: list,
          booked: list.reduce((n, x) => n + x.bookings.length, 0),
        })),
      };
    },

    /* 데모 초기화 */
    async reset() {
      state = fresh();
      save();
      return true;
    },
  };
})();
