/* ============================================================
   미정 클래스 — 예약 로직 테스트 (Node VM)
   ------------------------------------------------------------
   data.js를 VM 컨텍스트에서 실행하고 localStorage·Date를 대체해
   수강생 예약/취소와 강사 대리 예약/취소를 검증합니다.

     node tests/api.test.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
const KEY = 'mijeong.class.v1';

/* ── 아주 작은 테스트 러너 ─────────────────────────────── */
let passed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

async function throws(name, fn, matcher) {
  try {
    await fn();
    ok(name, false, '예외가 나지 않음');
  } catch (err) {
    ok(name, !matcher || matcher.test(err.message), `message="${err.message}"`);
  }
}

/* ── VM 환경 ───────────────────────────────────────────── */
function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

function makeContext({ now, state }) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() {
      return now;
    }
  }

  const storage = makeStorage(state ? { [KEY]: JSON.stringify(state) } : {});
  const ctx = vm.createContext({
    console,
    Date: FakeDate,
    localStorage: storage,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(SRC, ctx, { filename: 'data.js' });
  const api = vm.runInContext('api', ctx);
  const read = () => JSON.parse(storage.getItem(KEY));
  return { api, ctx, storage, read };
}

/* ── 기준 시각과 데모 상태 ─────────────────────────────── */
// 2026-11-25 (수) 13:40 — 같은 날 14:00 핸드스탠드 수업 20분 전 (취소 마감 13:00 지남)
const NOW = new Date(2026, 10, 25, 13, 40, 0, 0).getTime();
const DAY = 86400000;

function baseStudents(now) {
  const iso = (ms) => new Date(ms).toISOString();
  return [
    { id: 'st_a', name: '이서연', code: 'MJ-2048', classes: ['handstand', 'functional', 'morning', 'coaching'], pass: { type: 4, total: 4, used: 1, issuedAt: iso(now - 10 * DAY), expiresAt: iso(now + 30 * DAY) }, createdAt: iso(now - 30 * DAY) },
    { id: 'st_sold', name: '박지우', code: 'MJ-0812', classes: ['handstand'], pass: { type: 8, total: 8, used: 8, issuedAt: iso(now - 60 * DAY), expiresAt: iso(now + 10 * DAY) }, createdAt: iso(now - 60 * DAY) },
    { id: 'st_exp', name: '최만료', code: 'MJ-0001', classes: ['handstand'], pass: { type: 4, total: 4, used: 1, issuedAt: iso(now - 90 * DAY), expiresAt: iso(now - 1 * DAY) }, createdAt: iso(now - 90 * DAY) },
    { id: 'st_new', name: '김하늘', code: 'MJ-1024', classes: [], pass: null, createdAt: iso(now - 1 * DAY) },
    /* 오프라인만 듣는 수강생 · 모닝만 듣는 수강생 (접근 제어 확인용) */
    { id: 'st_only_off', name: '한오프', code: 'MJ-3001', classes: ['functional'], pass: { type: 4, total: 4, used: 0, issuedAt: iso(now - 3 * DAY), expiresAt: iso(now + 57 * DAY) }, createdAt: iso(now - 3 * DAY) },
    { id: 'st_only_morn', name: '남모닝', code: 'MJ-3002', classes: ['morning'], pass: null, createdAt: iso(now - 4 * DAY) },
  ];
}

function baseState(now, bookings) {
  return { version: 3, students: baseStudents(now), requests: [], bookings: bookings || [] };
}

/* 수업 id 찾기: 로컬 시각 기준 */
async function sessionId(api, { y, m, d, hh, mm }) {
  const list = await api.listSessions(30);
  const target = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  const hit = list.find((s) => new Date(s.startISO).getTime() === target);
  if (!hit) throw new Error(`수업을 찾지 못함: ${y}-${m}-${d} ${hh}:${mm}`);
  return hit.id;
}

(async () => {
  /* ────────────────────────────────────────────────────────
     1. 강사 대리 예약 — 잔여 1회 차감 + 기록
     ──────────────────────────────────────────────────────── */
  console.log('\n[1] 강사 대리 예약');
  {
    const { api, read } = makeContext({ now: NOW, state: baseState(NOW) });
    const sid = await sessionId(api, { y: 2026, m: 11, d: 26, hh: 14, mm: 0 }); // 목 14:00

    const before = await api.getStudent('st_a');
    eq('시작 전 잔여 3회', before.pass.remaining, 3);

    const after = await api.adminBook('st_a', sid);
    eq('예약 후 잔여 2회', after.pass.remaining, 2);
    eq('사용 2회로 증가', after.pass.used, 2);
    eq('예약 목록 1건', after.bookings.length, 1);
    eq('예약한 수업 id', after.bookings[0].sessionId, sid);

    const saved = read();
    eq('저장된 예약에 강사 표시', saved.bookings[0].by, 'instructor');
    eq('저장된 used', saved.students.find((s) => s.id === 'st_a').pass.used, 2);
  }

  /* ────────────────────────────────────────────────────────
     2. 대리 예약 규칙 — 중복 · 소진 · 만료 · 수강권 없음 · 시작한 수업
     ──────────────────────────────────────────────────────── */
  console.log('\n[2] 대리 예약 규칙');
  {
    const sid = await (async () => {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      return sessionId(api, { y: 2026, m: 11, d: 26, hh: 14, mm: 0 });
    })();

    // 중복
    {
      const dup = baseState(NOW, [{ id: 'bk_dup', studentId: 'st_a', sessionId: sid, createdAt: new Date(NOW).toISOString() }]);
      const { api } = makeContext({ now: NOW, state: dup });
      await throws('이미 예약한 수업은 막힘', () => api.adminBook('st_a', sid), /이미 예약한/);
    }

    // 소진된 수강권
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      await throws('소진된 수강권은 막힘', () => api.adminBook('st_sold', sid), /수강권/);
    }

    // 만료된 수강권
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      await throws('만료된 수강권은 막힘', () => api.adminBook('st_exp', sid), /수강권/);
    }

    // 수강권 없음
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      await throws('수강권 없는 수강생은 막힘', () => api.adminBook('st_new', sid), /수강권/);
    }

    // 이미 시작한 수업 (13:40 기준 오늘 12:00 수업은 지난 뒤이므로 목록에 없음 → 14:00 수업을 14:30 시각으로)
    {
      const LATER = new Date(2026, 10, 25, 14, 30, 0, 0).getTime();
      const { api } = makeContext({ now: LATER, state: baseState(LATER) });
      const started = await sessionId(api, { y: 2026, m: 11, d: 25, hh: 14, mm: 0 });
      await throws('이미 시작한 수업은 예약 불가', () => api.adminBook('st_a', started), /이미 시작/);
    }
  }

  /* ────────────────────────────────────────────────────────
     3. 강사 대리 취소 — 1시간 전 마감 이후에도 취소 + 횟수 복구
     ──────────────────────────────────────────────────────── */
  console.log('\n[3] 강사 대리 취소 (마감 이후)');
  {
    const sid = await (async () => {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      return sessionId(api, { y: 2026, m: 11, d: 25, hh: 14, mm: 0 });
    })();

    const state = baseState(NOW, [{ id: 'bk_late', studentId: 'st_a', sessionId: sid, createdAt: new Date(NOW - 2 * DAY).toISOString() }]);
    state.students[0].pass.used = 2; // 예약 1건 포함 2회 사용
    const { api, read } = makeContext({ now: NOW, state });

    const v = await api.getStudent('st_a');
    eq('취소 전 잔여 2회', v.pass.remaining, 2);

    await throws('수강생 본인은 마감 후 취소 불가', () => api.cancel('st_a', 'bk_late'), /취소 마감/);

    const after = await api.adminCancel('bk_late');
    eq('강사 취소 후 잔여 3회', after.pass.remaining, 3);
    eq('사용 1회로 복구', after.pass.used, 1);
    eq('예약 목록 비움', after.bookings.length, 0);
    eq('저장소에서도 삭제', read().bookings.length, 0);
    eq('저장된 used', read().students.find((s) => s.id === 'st_a').pass.used, 1);
  }

  /* ────────────────────────────────────────────────────────
     4. 강사 대리 취소 — 마감 전 · 사용 0 하한 · 없는 예약
     ──────────────────────────────────────────────────────── */
  console.log('\n[4] 강사 대리 취소 (마감 전 · 예외)');
  {
    const sid = await (async () => {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      return sessionId(api, { y: 2026, m: 11, d: 26, hh: 14, mm: 0 });
    })();

    // 마감 전: 수강생 취소도 되고, 강사 취소도 같은 결과
    {
      const state = baseState(NOW, [{ id: 'bk_ok', studentId: 'st_a', sessionId: sid, createdAt: new Date(NOW).toISOString() }]);
      state.students[0].pass.used = 2;
      const { api } = makeContext({ now: NOW, state });
      const after = await api.adminCancel('bk_ok');
      eq('마감 전 강사 취소도 복구', after.pass.remaining, 3);
    }

    // used 0 하한
    {
      const state = baseState(NOW, [{ id: 'bk_zero', studentId: 'st_a', sessionId: sid, createdAt: new Date(NOW).toISOString() }]);
      state.students[0].pass.used = 0;
      const { api } = makeContext({ now: NOW, state });
      const after = await api.adminCancel('bk_zero');
      eq('used는 0 아래로 내려가지 않음', after.pass.used, 0);
    }

    // 없는 예약
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      await throws('없는 예약 id는 오류', () => api.adminCancel('bk_none'), /찾을 수 없/);
    }
  }

  /* ────────────────────────────────────────────────────────
     5. 강사 화면 데이터 — 마감/예약 가능 표시와 예약자 정보
     ──────────────────────────────────────────────────────── */
  console.log('\n[5] adminData');
  {
    const sid = await (async () => {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      return sessionId(api, { y: 2026, m: 11, d: 25, hh: 14, mm: 0 });
    })();
    const state = baseState(NOW, [{ id: 'bk_x', studentId: 'st_a', sessionId: sid, by: 'instructor', createdAt: new Date(NOW).toISOString() }]);
    state.students[0].pass.used = 2;
    const { api } = makeContext({ now: NOW, state });

    const data = await api.adminData();
    const flat = data.days.flatMap((d) => d.sessions);
    const late = flat.find((s) => s.id === sid);
    eq('20분 뒤 수업은 취소 마감 표시', late.late, true);
    eq('20분 뒤 수업도 예약은 가능', late.bookable, true);
    eq('예약자 이름', late.bookings[0].name, '이서연');
    eq('예약자 수강권 라벨', late.bookings[0].passLabel, '4회권');
    eq('강사가 넣은 예약 표시', late.bookings[0].by, 'instructor');

    const activeIds = data.students.filter((s) => s.status === 'active').map((s) => s.id);
    eq('대리 예약 가능한 수강생만', activeIds, ['st_a', 'st_only_off']);
  }

  /* ────────────────────────────────────────────────────────
     6. 대리 예약 → 수강생 화면 → 대리 취소 왕복
     ──────────────────────────────────────────────────────── */
  console.log('\n[6] 예약 → 취소 한 바퀴');
  {
    const { api } = makeContext({ now: NOW, state: baseState(NOW) });
    const sid = await sessionId(api, { y: 2026, m: 11, d: 28, hh: 12, mm: 0 }); // 토 12:00

    const booked = await api.adminBook('st_a', sid);
    eq('예약 후 잔여 2회', booked.pass.remaining, 2);
    const bookingId = booked.bookings[0].id;

    const cancelled = await api.adminCancel(bookingId);
    eq('취소 후 잔여 3회', cancelled.pass.remaining, 3);
    eq('예약 목록 비움', cancelled.bookings.length, 0);
  }

  /* ────────────────────────────────────────────────────────
     7. 온라인 클래스 주간 체크 · 노트
     ──────────────────────────────────────────────────────── */
  console.log('\n[7] 온라인 체크 · 노트');
  {
    const { api, read } = makeContext({ now: NOW, state: baseState(NOW) });
    const wk = api.weekKey();

    eq('처음에는 기록 없음', await api.getOnline('st_a'), {});
    eq('주 시작일 키(월요일)', wk, '2026-11-23');

    const rec = await api.setOnlineCheck('st_a', 'morning', wk, 'mm1', 0, true);
    eq('체크 저장', rec.checks.mm1[0], 1);
    await api.setOnlineCheck('st_a', 'morning', wk, 'mm1', 2, true);
    const stored = await api.getOnline('st_a');
    eq('같은 동작 다른 요일 누적', stored.morning[wk].checks.mm1, [1, 0, 1, 0, 0, 0, 0]);

    await api.setOnlineCheck('st_a', 'morning', wk, 'mm1', 2, false);
    eq('다시 누르면 해제', (await api.getOnline('st_a')).morning[wk].checks.mm1[2], 0);

    await api.setOnlineNote('st_a', 'morning', wk, '  오른쪽 어깨가 걸려요  ');
    eq('노트 저장', (await api.getOnline('st_a')).morning[wk].note, '  오른쪽 어깨가 걸려요  ');
    eq('저장 시각 기록', typeof read().online.st_a.morning[wk].updatedAt, 'string');

    await throws('학생 id 없으면 거부', () => api.setOnlineCheck('', 'morning', wk, 'mm1', 0, true), /로그인/);
    await throws('없는 프로그램 거부', () => api.setOnlineCheck('st_a', 'nope', wk, 'mm1', 0, true), /온라인 클래스/);
    await throws('없는 동작 거부', () => api.setOnlineCheck('st_a', 'morning', wk, 'zzz', 0, true), /동작/);
    await throws('잘못된 요일 거부', () => api.setOnlineCheck('st_a', 'morning', wk, 'mm1', 7, true), /요일/);
    await throws('비로그인 노트 거부', () => api.setOnlineNote('', 'morning', wk, 'x'), /로그인/);

    // 프로그램을 나눠서 저장되는지 (모닝 / 코칭)
    await api.setOnlineCheck('st_a', 'coaching', wk, 'b2', 1, true);
    const both = await api.getOnline('st_a');
    eq('프로그램별로 따로 저장', [!!both.morning, !!both.coaching], [true, true]);
    eq('코칭 동작 체크', both.coaching[wk].checks.b2[1], 1);

    // 지난 주는 다른 칸
    const lastWeek = api.weekKey(NOW - 7 * DAY);
    ok('지난주 키가 다름', lastWeek !== wk, `${lastWeek} / ${wk}`);
    eq('지난주는 빈 기록', await api.getOnline('st_a').then((o) => o.morning[lastWeek] || null), null);

    // 강사 요약
    const admin = await api.adminData();
    const mine = admin.online.find((x) => x.studentId === 'st_a');
    ok('강사 요약에 학생이 보임', !!mine, JSON.stringify(admin.online));
    const morning = mine && mine.items.find((i) => i.programId === 'morning');
    eq('모닝: 1/8 동작 · 1회', [morning.checked, morning.total, morning.count], [1, 8, 1]);
    eq('모닝 노트 그대로', morning.note, '  오른쪽 어깨가 걸려요  ');
    const coaching = mine && mine.items.find((i) => i.programId === 'coaching');
    eq('코칭: 1/8 동작', [coaching.checked, coaching.count], [1, 1]);
    ok('기록 없는 학생은 제외', !admin.online.some((x) => x.studentId === 'st_new'), JSON.stringify(admin.online.map((x) => x.studentId)));
  }

  /* ────────────────────────────────────────────────────────
     8. 온라인 기록이 없던 저장 데이터도 열린다 (마이그레이션)
     ──────────────────────────────────────────────────────── */
  console.log('\n[8] 기존 데이터 호환');
  {
    const old = baseState(NOW);
    delete old.online;
    const { api, read } = makeContext({ now: NOW, state: old });
    eq('기존 데이터에 online 칸 생성', await api.getOnline('st_a'), {});
    const rec = await api.setOnlineCheck('st_a', 'morning', api.weekKey(), 'mm2', 3, true);
    eq('바로 체크 가능', rec.checks.mm2[3], 1);
    ok('저장소에도 반영', !!read().online.st_a.morning);
  }

  /* ────────────────────────────────────────────────────────
     9. 수업별 접근 제어 — 수강한 수업만 예약·기록
     ──────────────────────────────────────────────────────── */
  console.log('\n[9] 수업별 접근 제어');
  {
    const { api } = makeContext({ now: NOW, state: baseState(NOW) });

    eq('오프라인만 듣는 수강생', await api.accessOf('st_only_off'), {
      classes: ['functional'], offline: ['functional'], online: [], sequence: false,
    });
    eq('모닝만 듣는 수강생', await api.accessOf('st_only_morn'), {
      classes: ['morning'], offline: [], online: ['morning'], sequence: false,
    });
    const accA = await api.accessOf('st_a');
    eq('네 수업 모두 듣는 수강생', accA.classes, ['handstand', 'functional', 'morning', 'coaching']);
    eq('핸드스탠드 수강생만 시퀀스 열림', [accA.sequence, (await api.accessOf('st_only_off')).sequence], [true, false]);
    eq('없는 수강생은 null', await api.accessOf('nope'), null);

    const hsId = await sessionId(api, { y: 2026, m: 11, d: 26, hh: 14, mm: 0 });
    const fuId = await sessionId(api, { y: 2026, m: 11, d: 29, hh: 10, mm: 0 });

    await throws('펑셔널만 듣는 수강생은 핸드스탠드 예약 불가', () => api.book('st_only_off', hsId), /수강 중인 수업/);
    const booked = await api.book('st_only_off', fuId);
    eq('펑셔널 수강생은 펑셔널 예약 가능', booked.bookings[0].classId, 'functional');

    const wk = api.weekKey();
    await throws('모닝 미수강생은 모닝 체크 불가', () => api.setOnlineCheck('st_only_off', 'morning', wk, 'mm1', 0, true), /수강 중인 온라인/);
    await throws('모닝 미수강생은 모닝 노트 불가', () => api.setOnlineNote('st_only_off', 'morning', wk, 'x'), /수강 중인 온라인/);
    const rec = await api.setOnlineCheck('st_only_morn', 'morning', wk, 'mm1', 0, true);
    eq('모닝 수강생은 모닝 체크 가능', rec.checks.mm1[0], 1);
    await throws('모닝 수강생은 코칭 노트 불가', () => api.setOnlineNote('st_only_morn', 'coaching', wk, 'x'), /수강 중인 온라인/);
    const loggedOff = await api.login({ name: '한오프', code: 'MJ-3001' });
    eq('로그인 뷰에 수업 목록 포함', loggedOff.classes, ['functional']);
  }

  /* ────────────────────────────────────────────────────────
     10. 강사: 회원 등록 · 수업 열기/닫기
     ──────────────────────────────────────────────────────── */
  console.log('\n[10] 강사 회원 · 수업 관리');
  {
    const { api, read } = makeContext({ now: NOW, state: baseState(NOW) });

    const created = await api.adminRegister({ name: '문하람', code: 'mj-7700', classes: ['morning', 'coaching'], passType: '4' });
    eq('등록: 코드는 대문자로', created.code, 'MJ-7700');
    eq('등록: 수업 2개', created.classes, ['morning', 'coaching']);
    eq('등록: 수강권 부여', created.pass.total, 4);
    const logged = await api.login({ name: '문하람', code: 'MJ-7700' });
    eq('등록한 회원 로그인', logged.id, created.id);

    const changed = await api.adminSetClasses(created.id, ['handstand']);
    eq('수업 변경', changed.classes, ['handstand']);
    eq('변경이 저장됨', read().students.find((s) => s.code === 'MJ-7700').classes, ['handstand']);
    eq('시퀀스도 같이 열림', changed.access.sequence, true);

    await throws('중복 코드 거부', () => api.adminRegister({ name: '다른사람', code: 'MJ-2048', classes: ['morning'] }), /수강 코드/);
    await throws('짧은 코드 거부', () => api.adminRegister({ name: '다른사람', code: 'x', classes: [] }), /수강 코드/);
    await throws('이름 없는 등록 거부', () => api.adminRegister({ name: '  ', code: 'MJ-9999', classes: [] }), /이름/);

    await api.request('st_new', 'register', ['morning', 'handstand']);
    const data = await api.adminData();
    eq('요청에 희망 수업 담김', data.pending[0].classes, ['handstand', 'morning']);
    const approved = await api.approveRequest(data.pending[0].id, '8');
    eq('승인 시 수업이 열림', approved.classes, ['handstand', 'morning']);
    eq('승인 시 수강권', approved.pass.total, 8);
    ok('강사 목록에 수업 포함', data.students.find((s) => s.id === 'st_a').classes.length === 4);
    eq('강사 목록에 수업 로스터', data.roster.map((r) => r.id), ['handstand', 'functional', 'morning', 'coaching']);
  }

  /* ────────────────────────────────────────────────────────
     11. 데모 구성 · 레거시 데이터 호환
     ──────────────────────────────────────────────────────── */
  console.log('\n[11] 데모 구성 · 호환');
  {
    const { api } = makeContext({ now: NOW });
    const demo = [
      ['st_new', []],
      ['st_offline', ['handstand', 'functional', 'morning']],
      ['st_morning', ['morning']],
      ['st_coaching', ['handstand', 'morning', 'coaching']],
      ['st_expired', ['functional']],
    ];
    for (const [id, classes] of demo) {
      const v = await api.getStudent(id);
      eq(`데모 ${v.name} 수업`, v.classes, classes);
    }
    const offline = await api.getOnline('st_offline');
    eq('이서연 샘플 노트 3주치', Object.keys(offline.morning).length, 3);
    ok('지난주 샘플 노트', !!offline.morning[api.weekKey(NOW - 7 * DAY)].note);
    ok('2주 전 샘플 노트', !!offline.morning[api.weekKey(NOW - 14 * DAY)].note);
    ok('정민아 코칭 지난주 노트', !!(await api.getOnline('st_coaching')).coaching[api.weekKey(NOW - 7 * DAY)].note);

    // classes 없던 저장 데이터 (online-coaching 키 포함)
    const legacy = baseState(NOW);
    legacy.students.forEach((s) => { delete s.classes; });
    legacy.online = { st_a: { 'online-coaching': { [api.weekKey()]: { checks: { b2: [1, 0, 0, 0, 0, 0, 0] }, note: 'x', updatedAt: null } } } };
    const legacyCtx = makeContext({ now: NOW, state: legacy });
    eq('레거시 수업 추정', (await legacyCtx.api.getStudent('st_a')).classes, ['handstand', 'functional', 'coaching']);
    ok('online-coaching 기록이 coaching 으로 이동', !!(await legacyCtx.api.getOnline('st_a')).coaching);
    eq('레거시 기록은 한 곳에만', Object.keys((await legacyCtx.api.getOnline('st_a'))), ['coaching']);

    // version 1 데이터는 새 데모 구성으로 재시작
    const v1 = baseState(NOW);
    v1.version = 1;
    const v1Ctx = makeContext({ now: NOW, state: v1 });
    const warmed = await v1Ctx.api.getStudent('st_offline');
    eq('version 1 → 새 데모로 초기화', [!!warmed, warmed.classes], [true, ['handstand', 'functional', 'morning']]);
  }

  /* ────────────────────────────────────────────────────────
     12. 신규 등록 — 수업 필수 선택 · 다중 선택
     ──────────────────────────────────────────────────────── */
  console.log('\n[12] 신규 등록 — 수업 필수 · 다중 선택');
  {
    /* 12-1. 수업 0개는 신청 자체가 막힘 */
    {
      const { api, read } = makeContext({ now: NOW, state: baseState(NOW) });
      await throws('수업 0개는 신청 불가', () => api.request('st_new', 'register', []), /수업을 하나 이상/);
      await throws('수업 없이 보내면 신청 불가', () => api.request('st_new', 'register'), /수업을 하나 이상/);
      await throws('없는 수업만 골라도 신청 불가', () => api.request('st_new', 'register', ['nope', 'zzz']), /수업을 하나 이상/);
      await throws('없는 수강권 종류는 거부', () => api.request('st_new', 'register', ['morning'], { passType: '12' }), /수강권/);
      eq('막힌 신청은 저장되지 않음', (await api.adminData()).pending.length, 0);
      eq('저장소 요청도 0건', read().requests.length, 0);
      eq('김하늘은 여전히 열린 수업 없음', (await api.getStudent('st_new')).classes, []);
    }

    /* 12-2. 1개(온라인) 신청 → 승인 → 그 수업만 열림 (수강권 없이) */
    {
      const { api, read } = makeContext({ now: NOW, state: baseState(NOW) });
      const asked = await api.request('st_new', 'register', ['morning']);
      eq('신청 직후 확인 중', asked.status, 'pending');
      eq('신청한 수업이 신청서에 담김', asked.pending.classes, ['morning']);
      eq('신청서에 저장된 수업', read().requests[0].classes, ['morning']);

      const data = await api.adminData();
      eq('강사 대기 목록에 신청 수업', data.pending[0].classes, ['morning']);
      eq('온라인만이라 오프라인 수업 없음', data.pending[0].offline, 0);

      const v = await api.approveRequest(data.pending[0].id, '');
      eq('승인하면 신청한 수업이 열림', v.classes, ['morning']);
      eq('열린 수업 접근', v.access.online, ['morning']);
      eq('온라인만 신청은 수강권 없이', v.pass, null);
      eq('요청은 승인으로 정리', read().requests[0].status, 'approved');
    }

    /* 12-3. 오프라인 + 온라인 2개 동시 신청 → 승인 → 두 수업 모두 열림 */
    {
      const { api, read } = makeContext({ now: NOW, state: baseState(NOW) });
      const asked = await api.request('st_new', 'register', ['functional', 'morning'], { passType: 8 });
      eq('신청서에 두 수업', asked.pending.classes, ['functional', 'morning']);
      eq('희망 수강권 저장', asked.pending.passType, 8);

      const data = await api.adminData();
      eq('강사 목록 신청 수업 2개', data.pending[0].classes, ['functional', 'morning']);
      eq('오프라인 수업 포함', data.pending[0].offline, 1);
      eq('희망 수강권 전달', data.pending[0].passType, 8);

      const v = await api.approveRequest(data.pending[0].id, '8');
      eq('승인하면 두 수업 모두 열림', v.classes, ['functional', 'morning']);
      eq('오프라인/온라인 접근 함께 열림', [v.access.offline, v.access.online], [['functional'], ['morning']]);
      eq('8회권 개시', [v.pass.type, v.pass.total, v.pass.remaining], [8, 8, 8]);
      eq('사용 0회로 시작', read().students.find((s) => s.id === 'st_new').pass.used, 0);

      /* 오프라인 수업 예약과 온라인 체크가 같이 된다 */
      const fuId = await sessionId(api, { y: 2026, m: 11, d: 29, hh: 10, mm: 0 });
      const booked = await api.book('st_new', fuId);
      eq('열린 오프라인 수업 예약', booked.bookings[0].classId, 'functional');
      const rec = await api.setOnlineCheck('st_new', 'morning', api.weekKey(), 'mm1', 1, true);
      eq('열린 온라인 수업 체크', rec.checks.mm1[1], 1);
      const hsId = await sessionId(api, { y: 2026, m: 11, d: 26, hh: 14, mm: 0 });
      await throws('신청하지 않은 수업은 예약 불가', () => api.book('st_new', hsId), /수강 중인 수업/);
    }

    /* 12-4. 오프라인 2개 동시 신청 */
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      const asked = await api.request('st_new', 'renewal', ['handstand', 'functional'], { passType: 4 });
      eq('오프라인 두 수업 신청', asked.pending.classes, ['handstand', 'functional']);
      const data = await api.adminData();
      const v = await api.approveRequest(data.pending[0].id, '4');
      eq('두 오프라인 수업 모두 열림', v.classes, ['handstand', 'functional']);
      eq('시퀀스도 열림', v.access.sequence, true);

      const hsId = await sessionId(api, { y: 2026, m: 11, d: 26, hh: 14, mm: 0 });
      const fuId = await sessionId(api, { y: 2026, m: 11, d: 29, hh: 10, mm: 0 });
      await api.book('st_new', hsId);
      const both = await api.book('st_new', fuId);
      eq('두 수업 예약이 모두 들어감', both.bookings.map((b) => b.classId), ['handstand', 'functional']);
      eq('4회권 2회 사용', both.pass.used, 2);
    }

    /* 12-5. 이미 열린 수업은 유지하고 신청한 수업을 더함 */
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      /* 모닝만 듣던 수강생이 코칭을 추가 신청 */
      await api.request('st_only_morn', 'register', ['coaching']);
      let data = await api.adminData();
      const req = data.pending.find((r) => r.studentName === '남모닝');
      eq('추가 신청에도 수업이 담김', req.classes, ['coaching']);
      eq('이미 열린 수업은 유지 대상', req.currentClasses, ['morning']);
      const v = await api.approveRequest(req.id, '');
      eq('기존 + 신청 수업이 함께 열림', v.classes, ['morning', 'coaching']);
      eq('수강권은 여전히 없음', v.pass, null);

      /* 수강권이 소진된 수강생의 재등록 — 기존 수업 유지 */
      const { api: api2 } = makeContext({ now: NOW, state: baseState(NOW) });
      await api2.request('st_sold', 'renewal', ['handstand', 'morning']);
      data = await api2.adminData();
      const r2 = data.pending[0];
      eq('재등록 신청 수업', r2.classes, ['handstand', 'morning']);
      const v2 = await api2.approveRequest(r2.id, '8');
      eq('재등록 승인 후 수업', v2.classes, ['handstand', 'morning']);
      eq('재등록 수강권', [v2.pass.total, v2.pass.remaining], [8, 8]);
    }

    /* 12-6. 승인 쪽 검증 */
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      await api.request('st_new', 'register', ['handstand'], { passType: 4 });
      const data = await api.adminData();
      const id = data.pending[0].id;

      await throws('승인에서도 수업 0개는 막힘', () => api.approveRequest(id, '4', []), /수업을 하나 이상/);
      await throws('오프라인을 수강권 없이 열 수는 없음', () => api.approveRequest(id, ''), /수강권/);
      eq('막힌 승인 후에도 요청은 남아 있음', (await api.adminData()).pending.length, 1);

      const v = await api.approveRequest(id, '4', ['handstand', 'morning']);
      eq('강사가 고른 수업으로 승인', v.classes, ['handstand', 'morning']);
      await throws('처리된 요청은 다시 승인 불가', () => api.approveRequest(id, '4'), /찾을 수 없|이미 처리/);
      await throws('없는 요청은 오류', () => api.approveRequest('rq_none', '4'), /찾을 수 없/);
    }
  }

  /* ── [13] 금액표 ───────────────────────────────────────── */
  console.log('\n[13] 금액 정보');
  {
    const { ctx } = makeContext({ now: NOW });
    const price = vm.runInContext('({ PRICES, passPriceOf, offlinePassPrice, onlinePriceOf })', ctx);

    eq('핸드스탠드 4회권 180,000원', price.passPriceOf('handstand', 4), 180000);
    eq('핸드스탠드 8회권 300,000원', price.passPriceOf('handstand', 8), 300000);
    eq('펑셔널 수강권 금액은 미정', price.passPriceOf('functional', 8), null);
    eq('오프라인 둘을 골라도 확정 금액은 한 번만', price.offlinePassPrice(['handstand', 'functional'], 8), 300000);
    eq('펑셔널만 고르면 금액 미정', price.offlinePassPrice(['functional'], 4), null);
    eq('온라인만 고르면 수강권 금액 없음', price.offlinePassPrice(['morning'], 8), null);
    eq('모닝 모빌리티 정가 59,000원', price.onlinePriceOf('morning'), 59000);
    eq('코칭 금액은 미정', price.onlinePriceOf('coaching'), null);
    eq('얼리버드 마감일', price.PRICES.online.morning.was.until, '2026-11-20');
    eq('얼리버드 지난 가격', price.PRICES.online.morning.was.amount, 49000);
    eq('미정 안내 문구', price.PRICES.unknownLabel, '금액 추후 안내');
  }

  /* ── 결과 ─────────────────────────────────────────────── */
  console.log(`\n${failures.length ? '✗ 실패' : '✓ 통과'} — ${passed}개 확인, ${failures.length}개 실패`);
  if (failures.length) {
    failures.forEach((f) => console.log(`   · ${f}`));
    process.exit(1);
  }
})();
