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
    {
      id: 'st_a', name: '이서연', code: 'MJ-2048', classes: ['handstand', 'functional', 'morning', 'coaching'],
      passes: {
        handstand: { type: 4, total: 4, used: 1, issuedAt: iso(now - 10 * DAY), expiresAt: iso(now + 30 * DAY) },
        functional: { type: 4, total: 4, used: 0, issuedAt: iso(now - 10 * DAY), expiresAt: iso(now + 30 * DAY) },
      },
      createdAt: iso(now - 30 * DAY),
    },
    { id: 'st_sold', name: '박지우', code: 'MJ-0812', classes: ['handstand'], passes: { handstand: { type: 8, total: 8, used: 8, issuedAt: iso(now - 60 * DAY), expiresAt: iso(now + 10 * DAY) } }, createdAt: iso(now - 60 * DAY) },
    { id: 'st_exp', name: '최만료', code: 'MJ-0001', classes: ['handstand'], passes: { handstand: { type: 4, total: 4, used: 1, issuedAt: iso(now - 90 * DAY), expiresAt: iso(now - 1 * DAY) } }, createdAt: iso(now - 90 * DAY) },
    { id: 'st_new', name: '김하늘', code: 'MJ-1024', classes: [], passes: {}, createdAt: iso(now - 1 * DAY) },
    /* 오프라인만 듣는 수강생 · 모닝만 듣는 수강생 (접근 제어 확인용) */
    { id: 'st_only_off', name: '한오프', code: 'MJ-3001', classes: ['functional'], passes: { functional: { type: 4, total: 4, used: 0, issuedAt: iso(now - 3 * DAY), expiresAt: iso(now + 57 * DAY) } }, createdAt: iso(now - 3 * DAY) },
    { id: 'st_only_morn', name: '남모닝', code: 'MJ-3002', classes: ['morning'], passes: {}, createdAt: iso(now - 4 * DAY) },
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
    eq('저장된 used', saved.students.find((s) => s.id === 'st_a').passes.handstand.used, 2);
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
      await throws('수강권 없는 수강생은 막힘', () => api.adminBook('st_new', sid), /수강 중인 수업|수강권/);
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
    state.students[0].passes.handstand.used = 2; // 예약 1건 포함 2회 사용
    const { api, read } = makeContext({ now: NOW, state });

    const v = await api.getStudent('st_a');
    eq('취소 전 잔여 2회', v.pass.remaining, 2);

    await throws('수강생 본인은 마감 후 취소 불가', () => api.cancel('st_a', 'bk_late'), /취소 마감/);

    const after = await api.adminCancel('bk_late');
    eq('강사 취소 후 잔여 3회', after.pass.remaining, 3);
    eq('사용 1회로 복구', after.pass.used, 1);
    eq('예약 목록 비움', after.bookings.length, 0);
    eq('저장소에서도 삭제', read().bookings.length, 0);
    eq('저장된 used', read().students.find((s) => s.id === 'st_a').passes.handstand.used, 1);
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
      state.students[0].passes.handstand.used = 2;
      const { api } = makeContext({ now: NOW, state });
      const after = await api.adminCancel('bk_ok');
      eq('마감 전 강사 취소도 복구', after.pass.remaining, 3);
    }

    // used 0 하한
    {
      const state = baseState(NOW, [{ id: 'bk_zero', studentId: 'st_a', sessionId: sid, createdAt: new Date(NOW).toISOString() }]);
      state.students[0].passes.handstand.used = 0;
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
    state.students[0].passes.handstand.used = 2;
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
    eq('온라인만 등록하면 수강권 없음', created.pass, null);
    eq('온라인만 등록하면 수강권 칸도 비어 있음', created.passes, {});
    const logged = await api.login({ name: '문하람', code: 'MJ-7700' });
    eq('등록한 회원 로그인', logged.id, created.id);

    const changed = await api.adminSetClasses(created.id, ['handstand']);
    eq('수업 변경', changed.classes, ['handstand']);
    eq('변경이 저장됨', read().students.find((s) => s.code === 'MJ-7700').classes, ['handstand']);
    eq('시퀀스도 같이 열림', changed.access.sequence, true);

    await throws('중복 코드 거부', () => api.adminRegister({ name: '다른사람', code: 'MJ-2048', classes: ['morning'] }), /수강 코드/);
    await throws('짧은 코드 거부', () => api.adminRegister({ name: '다른사람', code: 'x', classes: [] }), /수강 코드/);
    await throws('이름 없는 등록 거부', () => api.adminRegister({ name: '  ', code: 'MJ-9999', classes: [] }), /이름/);

    await api.request('st_new', 'register', ['morning', 'handstand'], { passType: 8 });
    const data = await api.adminData();
    eq('요청에 희망 수업 담김', data.pending[0].classes, ['handstand', 'morning']);
    const approved = await api.approveRequest(data.pending[0].id, '8');
    eq('승인 시 수업이 열림', approved.classes, ['handstand', 'morning']);
    eq('승인 시 핸드스탠드 수강권', approved.passes.handstand.total, 8);
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
      eq('희망 수강권 저장', asked.pending.passTypes, { functional: 8 });

      const data = await api.adminData();
      eq('강사 목록 신청 수업 2개', data.pending[0].classes, ['functional', 'morning']);
      eq('오프라인 수업 포함', data.pending[0].offline, 1);
      eq('희망 수강권 전달', data.pending[0].passTypes, { functional: 8 });

      const v = await api.approveRequest(data.pending[0].id, '8');
      eq('승인하면 두 수업 모두 열림', v.classes, ['functional', 'morning']);
      eq('오프라인/온라인 접근 함께 열림', [v.access.offline, v.access.online], [['functional'], ['morning']]);
      eq('8회권 개시', [v.passes.functional.type, v.passes.functional.total, v.passes.functional.remaining], [8, 8, 8]);
      eq('사용 0회로 시작', read().students.find((s) => s.id === 'st_new').passes.functional.used, 0);

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
      eq('수업별로 한 번씩 사용', [both.passes.handstand.used, both.passes.functional.used], [1, 1]);
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
      await api2.request('st_sold', 'renewal', ['handstand', 'morning'], { passType: 8 });
      data = await api2.adminData();
      const r2 = data.pending[0];
      eq('재등록 신청 수업', r2.classes, ['handstand', 'morning']);
      const v2 = await api2.approveRequest(r2.id, '8');
      eq('재등록 승인 후 수업', v2.classes, ['handstand', 'morning']);
      eq('재등록 수강권', [v2.passes.handstand.total, v2.passes.handstand.remaining], [8, 8]);
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
    const price = vm.runInContext('({ PRICES, CONFIG, passPriceOf, offlinePassPrice, passTypesOfClasses, onlinePriceOf })', ctx);

    /* 수업별 수강권 금액 */
    eq('핸드스탠드 4회권 180,000원', price.passPriceOf('handstand', 4), 180000);
    eq('핸드스탠드 8회권 300,000원', price.passPriceOf('handstand', 8), 300000);
    eq('핸드스탠드는 1회권 없음', price.passPriceOf('handstand', 1), null);
    eq('펑셔널 1회권 35,000원', price.passPriceOf('functional', 1), 35000);
    eq('펑셔널 4회권 120,000원', price.passPriceOf('functional', 4), 120000);
    eq('펑셔널 8회권 200,000원', price.passPriceOf('functional', 8), 200000);

    /* 합계 — 수업마다 각각 합산 */
    eq('펑셔널만 1회권 35,000원', price.offlinePassPrice(['functional'], 1), 35000);
    eq('핸드스탠드+펑셔널 4회권 300,000원', price.offlinePassPrice(['handstand', 'functional'], 4), 300000);
    eq('핸드스탠드+펑셔널 8회권 500,000원', price.offlinePassPrice(['handstand', 'functional'], 8), 500000);
    eq('온라인만 고르면 수강권 금액 없음', price.offlinePassPrice(['morning'], 8), null);
    eq('모닝 모빌리티 정가 59,000원', price.onlinePriceOf('morning'), 59000);
    eq('코칭 7주 300,000원', price.onlinePriceOf('coaching'), 300000);
    eq('얼리버드 마감일', price.PRICES.online.morning.was.until, '2026-11-20');
    eq('미정 안내 문구', price.PRICES.unknownLabel, '금액 추후 안내');

    /* 1회권 규칙 — 1회 · 30일 */
    eq('1회권 횟수', price.CONFIG.passTypes[1].count, 1);
    eq('1회권 유효기간', price.CONFIG.passTypes[1].validDays, 30);
    eq('펑셔널이면 1·4·8회권 모두 가능', price.passTypesOfClasses(['functional']), [1, 4, 8]);
    eq('핸드스탠드가 있으면 4·8회권만', price.passTypesOfClasses(['handstand']), [4, 8]);
    eq('두 수업 함께여도 4·8회권만', price.passTypesOfClasses(['handstand', 'functional']), [4, 8]);
    eq('온라인만이면 전부', price.passTypesOfClasses(['morning']), [1, 4, 8]);

    /* 1회권 신청 → 승인 */
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      await api.request('st_new', 'register', ['functional'], { passType: 1 });
      let data = await api.adminData();
      eq('펑셔널 1회권 신청 접수', data.pending[0].passTypes, { functional: 1 });
      const v = await api.approveRequest(data.pending[0].id, '1');
      eq('1회권 개시 · 1회', [v.passes.functional.total, v.passes.functional.remaining], [1, 1]);
      eq('펑셔널 수업 열림', v.classes, ['functional']);
      eq('펑셔널 1회권은 유효기간 없음', v.passes.functional.expiresAt, null);
      eq('만료 체크 없음 표시', v.passes.functional.noExpiry, true);
    }

    /* 핸드스탠드에 1회권은 막힘 */
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      await throws('핸드스탠드 + 1회권 신청 거부',
        () => api.request('st_new', 'register', ['handstand'], { passType: 1 }),
        /4회권 · 8회권/);
      eq('거부된 신청은 저장되지 않음', (await api.adminData()).pending.length, 0);

      await api.request('st_new', 'register', ['handstand', 'functional'], { passType: 4 });
      const req = (await api.adminData()).pending[0];
      await throws('승인에서도 1회권은 막힘',
        () => api.approveRequest(req.id, '1'),
        /4회권 · 8회권/);
      const v = await api.approveRequest(req.id, '8');
      eq('8회권으로 승인 · 두 수업', [v.pass.total, v.classes.length], [8, 2]);
    }

    /* 강사가 직접 부여할 때도 같은 규칙 */
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      await throws('수강권 부여도 1회권 거부',
        () => api.grantPass('st_a', 1),
        /4회권 · 8회권/);
      const v = await api.grantPass('st_only_off', 1);
      eq('펑셔널만 듣는 수강생은 1회권 부여 가능', [v.pass.total, v.pass.remaining], [1, 1]);
    }
  }

  /* ── [14] 수업별 수강권 · 코칭 30만원 · 1회권 무기한 ──────── */
  console.log('\n[14] 수업별 수강권 · 코칭 30만원 · 1회권 유효기간 없음');
  {
    /* 14-1. 코칭 7주 300,000원 · 수업 카드/온라인 안내 */
    {
      const { ctx } = makeContext({ now: NOW });
      const info = vm.runInContext('({ PRICES, CLASSES, ONLINE, passValidDays, passTypesOfClass })', ctx);
      eq('코칭 금액 300,000원', info.PRICES.online.coaching.amount, 300000);
      eq('코칭 기간 7주', info.PRICES.online.coaching.weeks, 7);
      const coaching = info.CLASSES.find((c) => c.id === 'coaching');
      eq('수업 카드 기간 표기 7주', coaching.period, '7주');
      eq('수업 카드 안내 문구에 7주', /7주/.test(coaching.when), true);
      eq('온라인 트래커 설명에 7주', /7주/.test(info.ONLINE.coaching.sub), true);
      eq('코칭 7주 · 300,000원 합계', info.PRICES.online.coaching.amount * 1, 300000);
    }

    /* 14-2. 유효기간 — 펑셔널 1회권만 없음 */
    {
      const { ctx } = makeContext({ now: NOW });
      const f = vm.runInContext('({ passValidDays, passTypesOfClass })', ctx);
      eq('펑셔널 1회권 유효기간 없음', f.passValidDays('functional', 1), null);
      eq('펑셔널 4회권 60일', f.passValidDays('functional', 4), 60);
      eq('펑셔널 8회권 90일', f.passValidDays('functional', 8), 90);
      eq('핸드스탠드 4회권 60일', f.passValidDays('handstand', 4), 60);
      eq('핸드스탠드 8회권 90일', f.passValidDays('handstand', 8), 90);
      eq('핸드스탠드는 1회권 없음', f.passTypesOfClass('handstand'), [4, 8]);
      eq('펑셔널은 1·4·8회권', f.passTypesOfClass('functional'), [1, 4, 8]);
    }

    /* 14-3. 1회권은 시간이 지나도 살아 있음 (만료 체크 제외) */
    {
      const LATER = new Date(2027, 5, 1, 10, 0, 0, 0).getTime();  // 6개월 뒤
      const state = baseState(NOW);
      state.students.push({
        id: 'st_one', name: '오한번', code: 'MJ-4001', classes: ['functional'],
        passes: { functional: { type: 1, total: 1, used: 0, issuedAt: new Date(NOW).toISOString(), expiresAt: null } },
      });
      const { api } = makeContext({ now: LATER, state });
      const v = await api.getStudent('st_one');
      eq('6개월 뒤에도 사용 중', v.status, 'active');
      eq('만료 표시 없음', [v.passes.functional.expired, v.passes.functional.noExpiry], [false, true]);
      eq('D-day 없음 (expiresAt null)', v.passes.functional.expiresAt, null);
      const fuId = await sessionId(api, { y: 2027, m: 6, d: 6, hh: 10, mm: 0 }); // 일 10:00
      const booked = await api.book('st_one', fuId);
      eq('6개월 뒤에도 예약됨', booked.bookings[0].classId, 'functional');
      eq('1회권 소진', booked.passes.functional.remaining, 0);
    }

    /* 14-4. 두 수업을 다른 권종으로 신청 → 승인 → 수업별 발급 */
    {
      const { api, read } = makeContext({ now: NOW, state: baseState(NOW) });
      const asked = await api.request('st_new', 'register', ['handstand', 'functional'], {
        passTypes: { handstand: 8, functional: 1 },
      });
      eq('신청서에 수업별 권종', asked.pending.passTypes, { handstand: 8, functional: 1 });
      const req = (await api.adminData()).pending[0];
      eq('강사 목록에 수업별 권종', req.passTypes, { handstand: 8, functional: 1 });

      const v = await api.approveRequest(req.id, { handstand: 8, functional: 1 });
      eq('핸드스탠드 8회권', [v.passes.handstand.type, v.passes.handstand.remaining], [8, 8]);
      eq('펑셔널 1회권(무기한)', [v.passes.functional.type, v.passes.functional.remaining, v.passes.functional.expiresAt], [1, 1, null]);
      eq('두 수강권이 따로 저장됨', Object.keys(read().students.find((s) => s.id === 'st_new').passes), ['handstand', 'functional']);
      eq('핸드스탠드 유효기간 90일', Math.round((new Date(v.passes.handstand.expiresAt).getTime() - NOW) / DAY), 90);

      /* 예약은 그 수업의 수강권에서만 차감 */
      const hsId = await sessionId(api, { y: 2026, m: 11, d: 26, hh: 14, mm: 0 });
      const fuId = await sessionId(api, { y: 2026, m: 11, d: 29, hh: 10, mm: 0 });
      let cur = await api.book('st_new', hsId);
      eq('핸드스탠드 예약 → 핸드스탠드만 차감', [cur.passes.handstand.remaining, cur.passes.functional.remaining], [7, 1]);
      cur = await api.book('st_new', fuId);
      eq('펑셔널 예약 → 펑셔널만 차감', [cur.passes.handstand.remaining, cur.passes.functional.remaining], [7, 0]);

      /* 취소도 그 수업의 수강권만 복구 */
      const hsBooking = cur.bookings.find((b) => b.classId === 'handstand');
      cur = await api.cancel('st_new', hsBooking.id);
      eq('핸드스탠드 취소 → 핸드스탠드만 복구', [cur.passes.handstand.remaining, cur.passes.functional.remaining], [8, 0]);

      /* 펑셔널 1회권을 다 쓰면 다른 수업 수강권으로는 예약 불가 */
      await throws('펑셔널 소진 후 펑셔널 예약 불가', () => api.book('st_new', fuId), /펑셔널 요가 수강권/);
    }

    /* 14-5. 강사 대리 예약·취소도 그 수업 수강권만 */
    {
      const state = baseState(NOW);
      state.students.find((s) => s.id === 'st_a').passes.functional.used = 3;
      const { api } = makeContext({ now: NOW, state });
      const fuId = await sessionId(api, { y: 2026, m: 11, d: 29, hh: 10, mm: 0 }); // 일 10:00 펑셔널
      const v = await api.adminBook('st_a', fuId);
      eq('대리 예약은 펑셔널만 차감', [v.passes.handstand.remaining, v.passes.functional.remaining], [3, 0]);
      const booking = v.bookings.find((b) => b.classId === 'functional');
      const after = await api.adminCancel(booking.id);
      eq('대리 취소는 펑셔널만 복구', [after.passes.handstand.remaining, after.passes.functional.remaining], [3, 1]);
    }

    /* 14-6. 한 수업만 만료되어도 다른 수업은 계속 예약 */
    {
      const state = baseState(NOW);
      state.students.find((s) => s.id === 'st_a').passes.functional.expiresAt = new Date(NOW - DAY).toISOString();
      const { api } = makeContext({ now: NOW, state });
      const v = await api.getStudent('st_a');
      eq('펑셔널만 만료', [v.passes.handstand.active, v.passes.functional.active, v.status], [true, false, 'active']);
      const fuId = await sessionId(api, { y: 2026, m: 11, d: 29, hh: 10, mm: 0 });
      await throws('만료된 수업 예약 불가', () => api.book('st_a', fuId), /펑셔널 요가 수강권/);
      const hsId = await sessionId(api, { y: 2026, m: 11, d: 26, hh: 14, mm: 0 });
      const ok = await api.book('st_a', hsId);
      eq('핸드스탠드는 계속 예약', ok.bookings[0].classId, 'handstand');
    }

    /* 14-7. 강사가 수업별로 부여/갱신 */
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      const v = await api.grantPass('st_a', { handstand: 8, functional: 1 });
      eq('수업별로 부여', [v.passes.handstand.type, v.passes.functional.type], [8, 1]);
      eq('펑셔널 1회권은 무기한 부여', v.passes.functional.expiresAt, null);

      const again = await api.grantPass('st_a', { handstand: 4 });
      eq('한 수업만 갱신', [again.passes.handstand.type, again.passes.functional.type], [4, 1]);
      await throws('열리지 않은 수업에는 부여 불가', () => api.grantPass('st_only_morn', { handstand: 4 }), /오프라인 수업/);
      await throws('핸드스탠드에 1회권 부여 거부', () => api.grantPass('st_a', { handstand: 1 }), /4회권 · 8회권/);
    }

    /* 14-8. 이미 수강권이 있는 수업은 비워 두고 새 수업만 신청 */
    {
      const { api } = makeContext({ now: NOW, state: baseState(NOW) });
      const asked = await api.request('st_a', 'register', ['handstand', 'functional'], { passTypes: {} });
      eq('이미 있는 수강권은 그대로 신청', asked.pending.passTypes, {});
      const req = (await api.adminData()).pending[0];
      const v = await api.approveRequest(req.id, {});
      eq('기존 수강권 유지', [v.passes.handstand.used, v.passes.functional.used], [1, 0]);
    }
  }

  /* ── [15] 단일 pass → 수업별 passes 마이그레이션 ───────── */
  console.log('\n[15] 예전 단일 수강권 데이터 마이그레이션');
  {
    const state = baseState(NOW);
    state.students = [
      {
        id: 'st_legacy', name: '구자료', code: 'MJ-5001', classes: ['handstand', 'functional', 'morning'],
        pass: { type: 4, total: 4, used: 2, issuedAt: new Date(NOW - 10 * DAY).toISOString(), expiresAt: new Date(NOW + 20 * DAY).toISOString() },
      },
      {
        id: 'st_legacy_exp', name: '구만료', code: 'MJ-5002', classes: ['functional'],
        pass: { type: 4, total: 4, used: 4, issuedAt: new Date(NOW - 100 * DAY).toISOString(), expiresAt: new Date(NOW - 5 * DAY).toISOString() },
      },
    ];
    state.requests = [{
      id: 'rq_legacy', studentId: 'st_legacy', type: 'renewal', classes: ['handstand', 'functional'],
      passType: 8, status: 'pending', createdAt: new Date(NOW).toISOString(),
    }];
    const { api, read } = makeContext({ now: NOW, state });

    const v = await api.getStudent('st_legacy');
    eq('단일 pass가 수업별 passes로', Object.keys(v.passes), ['handstand', 'functional']);
    eq('첫 수업이 원래 사용 횟수를 이어받음', [v.passes.handstand.type, v.passes.handstand.used, v.passes.handstand.remaining], [4, 2, 2]);
    eq('둘째 수업은 같은 권종·사용 0회', [v.passes.functional.type, v.passes.functional.used, v.passes.functional.remaining], [4, 0, 4]);
    eq('유효기간도 그대로', v.passes.functional.expiresAt, new Date(NOW + 20 * DAY).toISOString());
    eq('예전 pass 필드는 정리', read().students.find((s) => s.id === 'st_legacy').pass, undefined);
    ok('마이그레이션 후 바로 예약 가능', (await api.book('st_legacy', await sessionId(api, { y: 2026, m: 11, d: 26, hh: 14, mm: 0 }))).bookings.length === 1);

    const exp = await api.getStudent('st_legacy_exp');
    eq('만료된 단일 수강권도 수업별로', [exp.status, exp.passes.functional.expired], ['exhausted', true]);

    const pending = (await api.adminData()).pending.find((r) => r.id === 'rq_legacy');
    eq('예전 신청서 passType → passTypes', pending.passTypes, { handstand: 8, functional: 8 });
    const okay = await api.approveRequest('rq_legacy', undefined, ['handstand', 'functional']);
    eq('예전 신청서도 승인 가능', [okay.passes.handstand.type, okay.passes.functional.type], [8, 8]);
  }

  /* ────────────────────────────────────────────────────────
     16. 공지사항 — 작성 · 수정 · 삭제 · 대상 필터링
     ──────────────────────────────────────────────────────── */
  console.log('\n[16] 공지사항');
  {
    // 저장된 공지가 없는 예전 데이터 → 데모 공지 2건이 한 번 들어갑니다
    const { api, read } = makeContext({ now: NOW, state: baseState(NOW) });
    await api.listNotices('st_a');
    const seeded = read().notices || [];
    eq('데모 공지 2건', seeded.length, 2);
    eq('전체 공지 + 수업 공지', seeded.map((n) => n.target).sort(), ['all', 'handstand']);

    // 회원별 노출 — 전체 공지 + 수강 중인 수업 공지만
    const all = await api.listNotices('st_a');
    eq('모든 수업 수강생은 두 건', all.length, 2);
    eq('상단 고정이 먼저', all[0].pinned, true);
    const morningOnly = await api.listNotices('st_only_morn');
    eq('모닝만 듣는 회원은 전체 공지만', morningOnly.map((n) => n.target), ['all']);
    const offlineOnly = await api.listNotices('st_only_off');
    eq('펑셔널만 듣는 회원도 전체 공지는 보임', offlineOnly.map((n) => n.target), ['all']);
    eq('없는 수강생은 빈 목록', await api.listNotices('nobody'), []);

    // 등록 — 검증
    await throws('제목 없는 공지는 막힘', () => api.addNotice({ title: '  ', body: '본문', target: 'all' }), /제목/);
    await throws('내용 없는 공지는 막힘', () => api.addNotice({ title: '제목', body: '', target: 'all' }), /내용/);
    await throws('없는 대상을 막힘', () => api.addNotice({ title: '제목', body: '본문', target: 'yoga' }), /대상/);

    // 등록 — 대상별 노출
    const added = await api.addNotice({ title: '펑셔널 요가 매트 준비', body: '이번 주 펑셔널 요가는 매트를 챙겨 주세요.', target: 'functional', pinned: false });
    ok('공지 id가 생김', /^nt_/.test(added.id));
    eq('작성일은 오늘', added.createdAt, '2026-11-25');
    eq('등록한 공지는 수업 회원에게만', (await api.listNotices('st_only_off')).map((n) => n.title), ['12월 수업 시간표를 열었어요', '펑셔널 요가 매트 준비']);
    eq('그 수업을 안 듣는 회원에게는 안 보임', (await api.listNotices('st_only_morn')).length, 1);
    ok('저장소에 남음', read().notices.some((n) => n.id === added.id));

    // 상단 고정이면 맨 위로
    const pinnedNotice = await api.addNotice({ title: '휴강 안내', body: '11월 30일 수업은 쉽니다.', target: 'all', pinned: true });
    eq('고정 공지가 맨 앞', (await api.listNotices('st_only_morn')).map((n) => n.id), [pinnedNotice.id, 'nt_demo1']);

    // 수정
    const edited = await api.updateNotice(added.id, { title: '펑셔널 요가 — 매트 준비', target: 'all', pinned: true });
    eq('제목·대상·고정 수정', [edited.title, edited.target, edited.pinned], ['펑셔널 요가 — 매트 준비', 'all', true]);
    eq('본문은 그대로', edited.body, '이번 주 펑셔널 요가는 매트를 챙겨 주세요.');
    eq('대상을 전체로 바꾸면 모두에게', (await api.listNotices('st_only_morn')).length, 3);
    await throws('없는 공지 수정은 막힘', () => api.updateNotice('nt_none', { title: 'x' }), /공지를 찾을 수/);
    await throws('수정해도 빈 제목은 막힘', () => api.updateNotice(added.id, { title: '' }), /제목/);

    // 수강생 상세에도 공지가 실립니다
    const v = await api.getStudent('st_only_morn');
    eq('getStudent 에 공지 포함', v.notices.length, 3);
    ok('공지마다 필드가 채워짐', v.notices.every((n) => n.id && n.title && n.body && n.target && n.createdAt));

    // 삭제 — 두 번 지우면 오류, 지운 뒤에는 다시 채우지 않음
    eq('삭제 성공', await api.deleteNotice(pinnedNotice.id), true);
    ok('목록에서 사라짐', !(await api.listNotices('st_a')).some((n) => n.id === pinnedNotice.id));
    await throws('없는 공지 삭제는 막힘', () => api.deleteNotice(pinnedNotice.id), /공지를 찾을 수/);

    const saved = read();
    saved.notices = [];
    const again = makeContext({ now: NOW, state: saved });
    eq('강사가 모두 지우면 빈 상태가 유지됨', again.read().notices, []);
    eq('빈 상태에서는 회원에게도 안 보임', await again.api.listNotices('st_a'), []);

    // 다시 불러온 뒤에도 고정·최신순 그대로
    const reloaded = makeContext({ now: NOW, state: saved });
    await reloaded.api.addNotice({ title: 'A', body: 'a', target: 'all', pinned: false });
    await reloaded.api.addNotice({ title: 'B', body: 'b', target: 'all', pinned: true });
    await reloaded.api.addNotice({ title: 'C', body: 'c', target: 'all', pinned: false });
    const order = (await reloaded.api.listNotices('st_a')).map((n) => n.title);
    eq('고정 공지가 먼저', order[0], 'B');
    eq('나머지는 뒤에', order.slice(1).sort(), ['A', 'C']);
  }

  /* ── 결과 ─────────────────────────────────────────────── */
  console.log(`\n${failures.length ? '✗ 실패' : '✓ 통과'} — ${passed}개 확인, ${failures.length}개 실패`);
  if (failures.length) {
    failures.forEach((f) => console.log(`   · ${f}`));
    process.exit(1);
  }
})();
