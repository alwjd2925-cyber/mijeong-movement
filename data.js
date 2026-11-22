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
    4: { count: 4, validDays: 60, label: '4회권' },
    8: { count: 8, validDays: 90, label: '8회권' },
  },
};

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
    blurb:
      '아침에 몸을 깨우는 온라인 모빌리티 클래스입니다. 잠결에 굳은 관절을 부드럽게 풀고 하루의 움직임을 편하게 여는 루틴을 함께 합니다. 집에서 매트 하나로 이어갈 수 있어요.',
    note: '온라인 · 일정/신청 문의',
  },
  {
    id: 'online-coaching',
    name: '핸드스탠드 온라인 코칭',
    en: 'Handstand Online Coaching',
    icon: 'online',
    mode: 'online',
    duration: null,
    slots: [],
    when: '온라인 코칭 · 개별/정기 진행',
    blurb:
      '온라인으로 피드백과 맞춤 연습을 주고받으며 핸드스탠드를 이어가는 코칭입니다. 오프라인 수업에서 잡은 감각을 집에서 놓지 않도록, 지금 수준에 맞는 연습을 골라 드립니다.',
    note: '온라인 · 인스타 DM 신청',
  },
];

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

  /* 최초 실행 시 데모 데이터 */
  function fresh() {
    const now = new Date();
    const iso = (d) => d.toISOString();
    const students = [
      // 아직 수강권이 없는 신규 수강생
      { id: 'st_new', name: '김하늘', code: 'MJ-1024', pass: null, createdAt: iso(addDays(now, -1)) },
      // 4회권 보유 (1회 예약 → 3회 남음)
      {
        id: 'st_pass4', name: '이서연', code: 'MJ-2048',
        pass: { type: 4, total: 4, used: 1, issuedAt: iso(addDays(now, -10)), expiresAt: iso(addDays(now, 50)) },
        createdAt: iso(addDays(now, -30)),
      },
      // 8회권을 모두 쓰고 만료된 수강생
      {
        id: 'st_exhausted', name: '박지우', code: 'MJ-0812',
        pass: { type: 8, total: 8, used: 8, issuedAt: iso(addDays(now, -75)), expiresAt: iso(addDays(now, -5)) },
        createdAt: iso(addDays(now, -90)),
      },
      // 8회권 보유 (2회 예약 → 5회 남음)
      {
        id: 'st_pass8', name: '정민아', code: 'MJ-1125',
        pass: { type: 8, total: 8, used: 3, issuedAt: iso(addDays(now, -14)), expiresAt: iso(addDays(now, 76)) },
        createdAt: iso(addDays(now, -20)),
      },
    ];
    const state = { version: 1, students, requests: [], bookings: [] };

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
    seed('st_pass4', hs[0]);
    seed('st_pass8', hs[1] || hs[0]);
    seed('st_pass8', first('functional'));
    return state;
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
    if (!state || state.version !== 1) {
      state = fresh();
      save();
    }
    prune();
    return state;
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
    if (!student.pass) return { status: pending ? 'pending' : 'new', pending: pending || null };
    const remaining = Math.max(0, student.pass.total - student.pass.used);
    const expired = Date.now() > new Date(student.pass.expiresAt).getTime();
    if (expired || remaining <= 0) {
      return { status: pending ? 'pending' : 'exhausted', pending: pending || null };
    }
    /* 수강권이 남아 있으면 요청이 대기 중이어도 계속 예약할 수 있습니다 */
    return { status: 'active', pending: pending || null };
  }

  /* 앱이 쓰는 수강생 뷰 (계산된 값 포함) */
  function viewStudent(id) {
    const s = load();
    const student = s.students.find((x) => x.id === id);
    if (!student) return null;
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
    if (student.pass) {
      const remaining = Math.max(0, student.pass.total - student.pass.used);
      pass = {
        ...student.pass,
        remaining,
        expired: Date.now() > new Date(student.pass.expiresAt).getTime(),
        label: (CONFIG.passTypes[student.pass.type] || {}).label || `${student.pass.type}회권`,
      };
    }
    return {
      id: student.id,
      name: student.name,
      code: student.code,
      status,
      pending: pending ? { id: pending.id, type: pending.type, createdAt: pending.createdAt } : null,
      pass,
      bookings,
    };
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
      if (v.status !== 'active') throw new Error('수강권이 활성화된 수강생만 예약할 수 있어요.');

      const session = sessionFor(sessionId);
      if (!session) throw new Error('예약할 수 없는 시간이에요.');
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
      student.pass.used += 1;
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
      if (student && student.pass) student.pass.used = Math.max(0, student.pass.used - 1);
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
    async request(studentId, type) {
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) throw new Error('수강생 정보를 찾을 수 없어요.');
      if (s.requests.some((r) => r.studentId === studentId && r.status === 'pending')) {
        throw new Error('이미 확인 중인 요청이 있어요.');
      }
      const request = {
        id: uid('rq'),
        studentId,
        type, // 'register' | 'renewal'
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      s.requests.push(request);
      save();
      return viewStudent(studentId);
    },

    /* ── 강사: 수강권 부여 / 요청 승인 ── */
    async grantPass(studentId, type) {
      const s = load();
      const student = s.students.find((x) => x.id === studentId);
      if (!student) throw new Error('수강생을 찾을 수 없어요.');
      const t = CONFIG.passTypes[type];
      if (!t) throw new Error('수강권 종류를 선택해 주세요.');

      /* 이미 잡혀 있는 예약은 새 수강권에서도 소진으로 계산 */
      const upcoming = s.bookings.filter((b) => {
        if (b.studentId !== studentId) return false;
        const session = sessionFor(b.sessionId);
        return !!session;
      }).length;

      const now = new Date();
      student.pass = {
        type: Number(type),
        total: t.count,
        used: Math.min(upcoming, t.count),
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + t.validDays * 86400000).toISOString(),
      };
      s.requests
        .filter((r) => r.studentId === studentId && r.status === 'pending')
        .forEach((r) => {
          r.status = 'approved';
          r.resolvedAt = now.toISOString();
        });
      save();
      return viewStudent(studentId);
    },

    async approveRequest(requestId, type) {
      const s = load();
      const req = s.requests.find((r) => r.id === requestId);
      if (!req) throw new Error('요청을 찾을 수 없어요.');
      return this.grantPass(req.studentId, type);
    },

    /* ── 강사 화면 데이터 ── */
    async adminData() {
      const s = load();
      const now = Date.now();
      const sessions = buildSessions(new Date(), CONFIG.bookingWindowDays);
      const students = s.students.map((st) => {
        const v = viewStudent(st.id);
        return { id: v.id, name: v.name, code: v.code, status: v.status, pass: v.pass };
      });
      const nameOf = new Map(students.map((st) => [st.id, st]));

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
                passLabel: info && info.pass ? info.pass.label : '',
              };
            }),
        });
      });

      return {
        now,
        students,
        pending: s.requests
          .filter((r) => r.status === 'pending')
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .map((r) => {
            const st = s.students.find((x) => x.id === r.studentId);
            return { id: r.id, type: r.type, createdAt: r.createdAt, studentName: st ? st.name : '—' };
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
