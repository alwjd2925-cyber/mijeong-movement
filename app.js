/* ============================================================
   미정 클래스 — app
   data.js의 데이터(CLASSES / WARMUP / SEQUENCES / CONFIG)와
   api를 화면에 연결합니다. 상태 저장은 모두 api 안에서 처리합니다.
   ============================================================ */

'use strict';

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const pad2 = (n) => String(n).padStart(2, '0');

  const esc = (str) =>
    String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));

  /* ── 시간 표기 ─────────────────────────────────────────── */
  const timeHM = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const shortDate = (date) => `${date.getMonth() + 1}.${date.getDate()} (${WEEK[date.getDay()]})`;
  const midDate = (date) => `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEK[date.getDay()]})`;
  const fullDate = (date) => `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
  const localKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

  function relativeTag(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((target - today) / 86400000);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    return '';
  }

  function minutesBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 60000);
  }

  /* ── 상태 ──────────────────────────────────────────────── */
  const UI = {
    studentId: null,
    level: 'beginner',
    resetArmed: false,
    adminStudent: '',   // 대리 예약 폼에서 마지막으로 고른 수강생
    adminSession: '',   // 대리 예약 폼에서 마지막으로 고른 수업
    onlineProgram: 'morning', // 온라인 클래스 탭
    onlineWeek: null,   // null = 이번 주, 그 외 'YYYY-MM-DD'(월요일) 주 시작일
    onlinePicked: false, // 수강생이 탭/노트 카드로 프로그램을 직접 골랐는지
    access: null,       // 로그인한 수강생이 볼 수 있는 범위
  };

  /* ── 수업별 접근 제어 ──────────────────────────────────── */
  const CLASS_SHORT = {
    handstand: '핸드스탠드',
    functional: '펑셔널',
    morning: '모닝',
    coaching: '코칭',
  };

  /* 데모 수강생 — 4가지 수업을 골고루 확인할 수 있게 */
  const DEMO_STUDENTS = [
    { id: 'st_new', label: '신규 수강생', hint: '김하늘 · 열린 수업 없음' },
    { id: 'st_offline', label: '오프라인 4회권', hint: '이서연 · 핸드스탠드 + 펑셔널 + 모닝' },
    { id: 'st_morning', label: '모닝 모빌리티', hint: '박지우 · 모닝만' },
    { id: 'st_coaching', label: '온라인 코칭', hint: '정민아 · 코칭 + 모닝 + 핸드스탠드' },
  ];

  function classMeta(id) {
    const cls = CLASSES.find((c) => c.id === id);
    return {
      id,
      name: cls ? cls.name : id,
      short: CLASS_SHORT[id] || (cls ? cls.name : id),
      mode: cls ? cls.mode : 'online',
    };
  }

  function classChipsHTML(v) {
    const classes = (v && v.classes) || [];
    if (!classes.length) return '<span class="class-chip is-none">열린 수업 없음</span>';
    return classes.map((id) => {
      const meta = classMeta(id);
      return `<span class="class-chip${meta.mode === 'online' ? ' is-online' : ''}">${esc(meta.short)}</span>`;
    }).join('');
  }

  /* 로그인 상태에 따라 볼 수 있는 섹션만 남깁니다 */
  function applyAccess(v) {
    const access = v && v.access ? v.access : null;
    UI.access = access;
    const showOnline = !!access && access.online.length > 0;
    const showSequence = !!access && access.sequence;

    const onlineSection = $('#online');
    const sequenceSection = $('#sequence');
    if (onlineSection) onlineSection.hidden = !showOnline;
    if (sequenceSection) sequenceSection.hidden = !showSequence;

    $$('.head-nav a').forEach((link) => {
      const href = link.getAttribute('href');
      if (href === '#online') link.hidden = !showOnline;
      else if (href === '#sequence') link.hidden = !showSequence;
      else if (href === '#booking') link.textContent = access ? 'booking' : 'login';
      if (link.hidden) link.classList.remove('is-current');
    });

    /* 온라인 클래스가 바뀌었을 때 현재 프로그램을 허용된 것 중에서 고릅니다 */
    if (access && access.online.length && access.online.indexOf(UI.onlineProgram) === -1) {
      UI.onlineProgram = access.online[0];
    }
  }

  function saveCurrent() {
    try {
      if (UI.studentId) localStorage.setItem('mijeong.current', UI.studentId);
      else localStorage.removeItem('mijeong.current');
    } catch (err) {
      /* 무시 */
    }
  }

  function loadCurrent() {
    try {
      return localStorage.getItem('mijeong.current');
    } catch (err) {
      return null;
    }
  }

  /* ── 토스트 ────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(message, isError) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', !!isError);
    node.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-on'), 2800);
  }

  /* ── class ─────────────────────────────────────────────── */
  function scheduleLabel(cls) {
    const groups = new Map();
    cls.slots.forEach((slot) => {
      const key = `${slot.start}–${slot.end}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(WEEK[slot.dow]);
    });
    return Array.from(groups.entries())
      .map(([time, days]) => `${days.join('·')} ${time}`)
      .join(' / ');
  }

  function renderClasses() {
    const grid = $('#classGrid');
    if (!grid) return;
    grid.innerHTML = CLASSES.map((cls) => {
      const online = cls.mode === 'online';
      return `
      <article class="class-card${online ? ' is-online' : ''}">
        <div class="class-art">
          <svg class="il" aria-hidden="true"><use href="#il-${esc(cls.icon)}"></use></svg>
          <svg class="il-dots" aria-hidden="true"><use href="#il-dots"></use></svg>
        </div>
        <div class="class-head">
          <div>
            <h3>${esc(cls.name)}</h3>
            <span class="class-en">${esc(cls.en)}</span>
          </div>
          <div class="class-meta">
            <span class="mode${online ? ' is-online' : ''}">${online ? '온라인' : '오프라인'}</span>
            ${cls.duration ? `<span class="class-dur">${esc(cls.duration)}</span>` : ''}
          </div>
        </div>
        <p class="class-when">${esc(cls.when || scheduleLabel(cls))}</p>
        <p class="class-blurb">${esc(cls.blurb)}</p>
        <p class="class-note">${esc(cls.note)}</p>
      </article>`;
    }).join('');
  }

  /* ── booking ───────────────────────────────────────────── */
  function passDots(pass) {
    let out = '';
    for (let i = 0; i < pass.total; i += 1) {
      out += `<span class="dot${i < pass.remaining ? ' is-left' : ''}"></span>`;
    }
    return out;
  }

  function dday(expiresAt) {
    const ms = new Date(expiresAt).getTime() - Date.now();
    const days = Math.ceil(ms / 86400000);
    if (days < 0) return '기간 만료';
    if (days === 0) return '오늘까지';
    return `D-${days}`;
  }

  function statusText(v) {
    if (!v) return '아직 로그인하지 않았어요';
    const offline = v.access ? v.access.offline : [];
    const online = v.access ? v.access.online : [];
    if (!offline.length && online.length) {
      return `온라인 클래스 수강 중 · ${online.map((id) => classMeta(id).name).join(' · ')}`;
    }
    if (v.status === 'active') return `${v.pass.label} 사용 중`;
    if (v.status === 'pending') return v.pending.type === 'renewal' ? '재등록 요청 확인 중' : '등록 신청 확인 중';
    if (v.status === 'exhausted') return `${v.pass.label} 사용 완료`;
    return '수강권 없음 · 신규 수강생';
  }

  function identityHTML(v) {
    if (!v) {
      return `
        <div class="stu-head">
          <div>
            <p class="stu-name">게스트</p>
            <p class="stu-sub">데모 수강생을 고르거나 이름과 코드로 로그인해 주세요</p>
          </div>
        </div>`;
    }
    return `
      <div class="stu-head">
        <div>
          <p class="stu-name">${esc(v.name)}<span class="stu-code">${esc(v.code)}</span></p>
          <p class="stu-sub">${esc(statusText(v))}</p>
          <p class="stu-classes">${classChipsHTML(v)}</p>
        </div>
        <button class="link-btn" type="button" data-logout>로그아웃</button>
      </div>`;
  }

  function statusBlockHTML(v) {
    if (!v) {
      return `
        <div class="state-banner">
          <p class="state-title">로그인하면 내 수업만 보여요</p>
          <p class="state-sub">
            수업별로 열린 페이지만 보입니다. 수강권이 있는 수강생은 날짜를 골라 바로 예약하고,
            온라인 클래스 수강생은 체크와 노트를 남길 수 있어요.
          </p>
        </div>`;
    }

    if (!v.access || !v.access.offline.length) {
      const online = (v.access && v.access.online) || [];
      if (online.length) {
        return `
        <div class="state-banner is-open">
          <p class="state-title">온라인 클래스 수강 중</p>
          <p class="state-sub">
            ${online.map((id) => esc(classMeta(id).name)).join(' · ')} — 예약 없이 위 online 섹션에서
            주차별 체크와 노트를 남길 수 있어요.
          </p>
          <button class="btn btn-line btn--sm" type="button" data-goto-online>온라인 클래스로 이동</button>
        </div>`;
      }
      if (v.status === 'pending') {
        return `
        <div class="state-banner is-pending">
          <p class="state-title">${v.pending.type === 'renewal' ? '재등록 요청' : '등록 신청'}을 보냈어요</p>
          <p class="state-sub">
            강사가 확인하고 수업을 열어 주면 바로 이용할 수 있어요.
            보낸 시각 ${fullDate(new Date(v.pending.createdAt))} ${timeHM(new Date(v.pending.createdAt))}
          </p>
        </div>`;
      }
      return `
      <div class="state-banner">
        <p class="state-title">아직 열린 수업이 없어요</p>
        <p class="state-sub">
          등록을 신청하면 강사가 확인하고 수강할 수업을 열어 드립니다.
          열린 수업에 따라 예약·체크·노트 화면이 보입니다.
        </p>
      </div>
      <button class="btn btn-butter btn-wide" type="button" data-action="register">등록 <span>신규 등록 신청</span></button>`;
    }

    if (v.status === 'active') {
      return `
        <div class="pass">
          <div class="pass-top">
            <span class="pass-label">${esc(v.pass.label)}</span>
            <span class="pass-remain"><b>${v.pass.remaining}</b> / ${v.pass.total}회 남음</span>
          </div>
          <div class="dots" aria-label="잔여 ${v.pass.remaining}회">${passDots(v.pass)}</div>
          <div class="pass-meta">
            <span>유효기간 ${fullDate(new Date(v.pass.expiresAt))}까지</span>
            <span>${esc(dday(v.pass.expiresAt))}</span>
            <span>사용 ${v.pass.used}회 · 예약 ${v.bookings.length}건</span>
            ${v.pending ? '<span class="pass-warn">재등록 요청 확인 중</span>' : ''}
          </div>
        </div>`;
    }

    if (v.status === 'pending') {
      const label = v.pending.type === 'renewal' ? '재등록 요청' : '등록 신청';
      return `
        <div class="state-banner is-pending">
          <p class="state-title">${esc(label)}을 보냈어요</p>
          <p class="state-sub">
            강사가 확인하고 수강권을 개시하면 바로 예약할 수 있어요.
            보낸 시각 ${fullDate(new Date(v.pending.createdAt))} ${timeHM(new Date(v.pending.createdAt))}
          </p>
        </div>`;
    }

    if (v.status === 'exhausted') {
      const p = v.pass;
      const reason = p.expired && p.remaining > 0
        ? `유효기간(${fullDate(new Date(p.expiresAt))})이 지났어요. 남은 ${p.remaining}회는 사용할 수 없습니다.`
        : `${p.label} ${p.used}/${p.total}회를 모두 사용했어요. (${fullDate(new Date(p.expiresAt))} 만료)`;
      return `
        <div class="state-banner">
          <p class="state-title">수강권을 다시 등록해야 해요</p>
          <p class="state-sub">${esc(reason)} 재등록을 요청하면 강사 확인 후 새 수강권이 열립니다.</p>
        </div>
        <button class="btn btn-butter btn-wide" type="button" data-action="renewal">재등록 <span>재등록 요청</span></button>`;
    }

    return `
      <div class="state-banner">
        <p class="state-title">아직 수강권이 없어요</p>
        <p class="state-sub">
          수강권은 4회권과 8회권이 있어요. 아래 버튼으로 등록을 신청하면
          강사가 확인하고 수강권을 개설해 드립니다.
        </p>
      </div>
      <button class="btn btn-butter btn-wide" type="button" data-action="register">등록 <span>신규 등록 신청</span></button>`;
  }

  function sessionRowHTML(session, v) {
    const start = new Date(session.startISO);
    const end = new Date(session.endISO);
    const mins = minutesBetween(session.startISO, session.endISO);
    const booking = v ? v.bookings.find((b) => b.sessionId === session.id) : null;
    const deadline = new Date(start.getTime() - CONFIG.cancelDeadlineMs);
    const cancelOpen = Date.now() <= deadline.getTime();

    let sub = `${mins}분`;
    let action = '';

    if (!v) {
      action = '<button class="btn-mini" type="button" disabled>로그인 후</button>';
    } else if (booking) {
      if (cancelOpen) {
        sub = `취소는 ${shortDate(deadline)} ${timeHM(deadline)}까지`;
        action = `
          <span class="badge">예약 완료</span>
          <button class="btn-mini" type="button" data-cancel="${esc(booking.id)}">취소</button>`;
      } else {
        sub = `취소 마감 · ${shortDate(deadline)} ${timeHM(deadline)}`;
        action = '<span class="badge">예약 완료</span><span class="cap">취소 마감</span>';
      }
    } else if (v.status === 'active') {
      action = `<button class="btn-mini btn-mini--butter" type="button" data-book="${esc(session.id)}">예약</button>`;
    } else if (v.status === 'pending') {
      action = '<button class="btn-mini" type="button" disabled>승인 대기</button>';
    } else {
      action = '<button class="btn-mini" type="button" disabled>수강권 필요</button>';
    }

    return `
      <div class="srow${booking ? ' is-booked' : ''}">
        <div class="srow-time">${timeHM(start)}</div>
        <div>
          <p class="srow-name">${esc(session.className)}</p>
          <p class="srow-sub">${esc(sub)}</p>
        </div>
        <div class="srow-act">${action}</div>
      </div>`;
  }

  function scheduleHTML(v, sessions) {
    const groups = new Map();
    sessions.forEach((session) => {
      const key = localKey(new Date(session.startISO));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    });
    const keys = Array.from(groups.keys()).sort();

    if (!keys.length) {
      return '<p class="admin-empty">예약 가능한 수업이 없습니다.</p>';
    }

    const dayBlocks = keys.map((key) => {
      const list = groups.get(key);
      const date = new Date(list[0].startISO);
      const tag = relativeTag(date);
      return `
        <div class="sched-day">
          <div class="sched-date">
            ${midDate(date)}
            ${tag ? `<em>${tag}</em>` : ''}
          </div>
          ${list.map((session) => sessionRowHTML(session, v)).join('')}
        </div>`;
    }).join('');

    return `
      <div class="sched">
        <div class="sched-head">
          <h4>예약 가능한 수업</h4>
          <span>${keys.length}일 · ${sessions.length}개 수업</span>
        </div>
        ${dayBlocks}
      </div>`;
  }

  function markDemo(activeId) {
    $$('#demoSwitch button').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.demo === activeId);
    });
  }

  /* 데모 수강생 버튼 — 각 버튼이 어떤 수업을 보는지 함께 표시 */
  function renderDemoSwitch() {
    const wrap = $('#demoSwitch');
    if (!wrap) return;
    wrap.innerHTML = DEMO_STUDENTS.map((demo) => `
      <button type="button" class="demo-btn" data-demo="${esc(demo.id)}">
        <span class="demo-label">${esc(demo.label)}</span>
        <span class="demo-hint">${esc(demo.hint)}</span>
      </button>`).join('');
  }

  async function renderBooking() {
    const area = $('#studentArea');
    if (!area) return;

    let student = null;
    if (UI.studentId) {
      student = await api.getStudent(UI.studentId);
      if (!student) {
        UI.studentId = null;
        saveCurrent();
      }
    }
    applyAccess(student);

    const sessions = await api.listSessions();
    const offline = student && student.access ? student.access.offline : [];
    const visibleSessions = sessions.filter((s) => offline.indexOf(s.classId) !== -1);
    markDemo(student ? student.id : null);

    area.innerHTML = `
      ${identityHTML(student)}
      ${statusBlockHTML(student)}
      ${offline.length ? scheduleHTML(student, visibleSessions) : ''}`;

    await renderOnline();
  }

  async function act(fn, successMessage) {
    try {
      await fn();
      await renderBooking();
      if (successMessage) toast(successMessage);
    } catch (err) {
      toast(err.message || '처리하지 못했어요.', true);
    }
  }

  function bindBooking() {
    const area = $('#studentArea');
    if (!area) return;

    area.addEventListener('click', async (event) => {
      const bookBtn = event.target.closest('[data-book]');
      if (bookBtn && UI.studentId) {
        const sessionId = bookBtn.dataset.book;
        const session = (await api.listSessions()).find((s) => s.id === sessionId);
        await act(
          () => api.book(UI.studentId, sessionId),
          session
            ? `예약했어요 · ${shortDate(new Date(session.startISO))} ${timeHM(new Date(session.startISO))}`
            : '예약했어요.',
        );
        return;
      }

      const cancelBtn = event.target.closest('[data-cancel]');
      if (cancelBtn && UI.studentId) {
        await act(() => api.cancel(UI.studentId, cancelBtn.dataset.cancel), '예약을 취소했어요. 횟수가 돌아왔습니다.');
        return;
      }

      const actionBtn = event.target.closest('[data-action]');
      if (actionBtn && UI.studentId) {
        const type = actionBtn.dataset.action;
        await act(
          () => api.request(UI.studentId, type),
          type === 'renewal' ? '재등록 요청을 보냈어요.' : '등록 신청을 보냈어요.',
        );
        return;
      }

      const logoutBtn = event.target.closest('[data-logout]');
      if (logoutBtn) {
        UI.studentId = null;
        UI.onlineWeek = null;
        UI.onlinePicked = false;
        saveCurrent();
        await renderBooking();
        toast('로그아웃했어요.');
        return;
      }

      const gotoOnline = event.target.closest('[data-goto-online]');
      if (gotoOnline) {
        const section = $('#online');
        if (section && !section.hidden) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    const demoSwitch = $('#demoSwitch');
    if (demoSwitch) {
      demoSwitch.addEventListener('click', async (event) => {
        const btn = event.target.closest('[data-demo]');
        if (!btn) return;
        UI.studentId = btn.dataset.demo;
        UI.onlineWeek = null;
        UI.onlinePicked = false;
        saveCurrent();
        await renderBooking();
      });
    }

    const form = $('#loginForm');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        try {
          const student = await api.login({ name: data.get('name'), code: data.get('code') });
          UI.studentId = student.id;
          UI.onlineWeek = null;
          UI.onlinePicked = false;
          saveCurrent();
          form.reset();
          await renderBooking();
          toast(`${student.name}님, 반가워요.`);
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
  }

  /* ── 온라인 클래스: 주간 체크 & 노트 ──────────────────── */
  const DAYS = [
    { ko: '월', en: 'Mon' },
    { ko: '화', en: 'Tue' },
    { ko: '수', en: 'Wed' },
    { ko: '목', en: 'Thu' },
    { ko: '금', en: 'Fri' },
    { ko: '토', en: 'Sat' },
    { ko: '일', en: 'Sun' },
  ];
  const ONLINE_WEEKS = [-3, -2, -1, 0, 1];

  function weekStart(offsetWeeks) {
    const now = new Date();
    const back = (now.getDay() + 6) % 7; // 월=0
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + offsetWeeks * 7);
  }

  function weekLabel(offsetWeeks) {
    const start = weekStart(offsetWeeks);
    const end = new Date(start.getTime() + 6 * 86400000);
    const base = offsetWeeks === 0 ? '이번 주'
      : offsetWeeks === -1 ? '지난주'
        : offsetWeeks === 1 ? '다음 주'
          : offsetWeeks < 0 ? `${-offsetWeeks}주 전` : `${offsetWeeks}주 후`;
    return `${base} · ${start.getMonth() + 1}.${start.getDate()}–${end.getMonth() + 1}.${end.getDate()}`;
  }

  /* 'YYYY-MM-DD'(월요일) → 그 주의 표기 */
  function weekKeyLabel(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const end = new Date(start.getTime() + 6 * 86400000);
    const diff = Math.round((start - weekStart(0)) / (7 * 86400000));
    const base = diff === 0 ? '이번 주'
      : diff === -1 ? '지난주'
        : diff === 1 ? '다음 주'
          : diff < 0 ? `${-diff}주 전` : `${diff}주 후`;
    return `${base} · ${start.getMonth() + 1}.${start.getDate()}–${end.getMonth() + 1}.${end.getDate()}`;
  }

  function currentWeekKey() {
    return UI.onlineWeek || api.weekKey();
  }

  /* 주차 선택지 — 최근 5주 + 기록이 있는 주(노트 카드를 눌러 오래된 주도 열 수 있음) */
  function weekOptions(records, keepKey) {
    const keys = new Set(ONLINE_WEEKS.map((w) => localKey(weekStart(w))));
    Object.keys(records || {}).forEach((key) => keys.add(key));
    if (keepKey) keys.add(keepKey);
    return Array.from(keys).sort();
  }

  /* 지금 수강생이 볼 수 있는 온라인 프로그램 */
  function allowedPrograms() {
    const allowed = UI.access ? UI.access.online : [];
    return allowed.map((id) => ONLINE[id]).filter(Boolean);
  }

  /* 처음 열 때는 가장 최근에 기록한 프로그램을 보여 줍니다 */
  function programWithRecentRecord(programs, records) {
    let best = programs[0];
    let bestAt = '';
    programs.forEach((p) => {
      const bucket = (records && records[p.id]) || {};
      Object.keys(bucket).forEach((key) => {
        const at = bucket[key] && bucket[key].updatedAt;
        if (at && at > bestAt) {
          bestAt = at;
          best = p;
        }
      });
    });
    return best;
  }

  function onlineCounts(program, record) {
    let checked = 0;
    let count = 0;
    program.movements.forEach((m) => {
      const row = (record && record.checks && record.checks[m.id]) || [];
      const hits = row.filter((v) => v === 1).length;
      count += hits;
      if (hits > 0) checked += 1;
    });
    return { checked, count, total: program.movements.length };
  }

  function trackTableHTML(program, record, locked) {
    const checks = (record && record.checks) || {};
    return `
      <div class="track-table-wrap">
        <table class="track-table">
          <thead>
            <tr>
              <th class="th-ex">Exercise</th>
              ${DAYS.map((d) => `<th><span class="d-en">${d.en}</span><span class="d-ko">${d.ko}</span></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${program.movements.map((m) => {
              const row = checks[m.id] || [];
              return `
              <tr>
                <th class="td-ex">
                  <span class="ex-name">${esc(m.name)}</span>
                  <button class="ex-video" type="button" data-video="${esc(m.id)}">영상 보기</button>
                </th>
                ${DAYS.map((d, i) => {
                  const on = row[i] === 1;
                  return `<td><button class="tick${on ? ' is-on' : ''}" type="button"
                    data-tick="${esc(m.id)}:${i}"
                    aria-pressed="${on ? 'true' : 'false'}"
                    aria-label="${esc(m.name)} ${d.ko}요일 체크"${locked ? ' disabled' : ''}>${on ? '✓' : ''}</button></td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function noteSavedText(record) {
    if (!record || !record.updatedAt) return '아직 저장된 노트가 없어요';
    const d = new Date(record.updatedAt);
    return `마지막 저장 ${shortDate(d)} ${timeHM(d)}`;
  }

  function trackNoteHTML(program, record, locked) {
    const note = (record && record.note) || '';
    return `
      <div class="track-note">
        <p class="tn-label">${esc(program.noteLabel)}</p>
        <p class="tn-hint">${esc(program.noteHint)}</p>
        <textarea id="onlineNote" rows="8" placeholder="${esc(program.noteHint)}"${locked ? ' disabled' : ''}>${esc(note)}</textarea>
        <div class="tn-foot">
          <span class="tn-status" id="noteStatus">${locked ? '로그인 후 저장됩니다' : esc(noteSavedText(record))}</span>
          <button class="btn-mini btn-mini--butter" type="button" data-save-note${locked ? ' disabled' : ''}>노트 저장</button>
        </div>
      </div>`;
  }

  async function renderOnline() {
    const panel = $('#trackPanel');
    if (!panel) return;

    const programs = allowedPrograms();
    if (!UI.studentId || !programs.length) {
      panel.innerHTML = '';
      return;
    }

    let program = ONLINE[UI.onlineProgram];
    if (!program || !programs.some((p) => p.id === program.id)) {
      program = programs[0];
      UI.onlineProgram = program.id;
    }

    const student = await api.getStudent(UI.studentId);
    if (!student) {
      UI.studentId = null;
      saveCurrent();
      await renderBooking();
      return;
    }

    const records = await api.getOnline(UI.studentId);

    /* 아직 프로그램을 직접 고르지 않았다면 가장 최근 기록이 있는 프로그램부터 */
    if (!UI.onlinePicked) {
      program = programWithRecentRecord(programs, records);
      UI.onlineProgram = program.id;
    }

    const key = currentWeekKey();
    const record = ((records[program.id] || {})[key]) || null;
    const { checked, count, total } = onlineCounts(program, record);
    const options = weekOptions(records[program.id], key)
      .map((k) => `<option value="${esc(k)}"${k === key ? ' selected' : ''}>${esc(weekKeyLabel(k))}</option>`)
      .join('');

    const tabs = programs.length > 1
      ? `<div class="ot-tabs" role="tablist" aria-label="온라인 클래스">${programs.map((p) => `
          <button class="ot-tab${p.id === program.id ? ' is-active' : ''}" type="button" role="tab"
            aria-selected="${p.id === program.id ? 'true' : 'false'}" data-program="${esc(p.id)}">
            <span class="mode is-online">온라인</span>${esc(p.name)}
          </button>`).join('')}</div>`
      : `<p class="ot-single"><span class="mode is-online">온라인</span>${esc(program.name)}</p>`;

    panel.innerHTML = `
      <div class="track-head">
        ${tabs}
        <div class="ot-week">
          <select class="select" id="onlineWeek" aria-label="주차 선택">${options}</select>
        </div>
      </div>
      <p class="track-sub">${esc(program.sub)}</p>
      <p class="track-sum"><b>${checked}</b> / ${total} 동작 · 이 주 ${count}회 체크 · <span class="track-who">${esc(student.name)}</span></p>
      <div class="track-body">
        ${trackTableHTML(program, record, false)}
        ${trackNoteHTML(program, record, false)}
      </div>
      ${noteLogHTML(records, programs)}`;
  }

  function refreshTrackSummary(record) {
    const sum = $('.track-sum');
    const program = ONLINE[UI.onlineProgram];
    if (!sum || !program) return;
    const { checked, count, total } = onlineCounts(program, record);
    const who = sum.querySelector('.track-who');
    sum.innerHTML = `<b>${checked}</b> / ${total} 동작 · 이 주 ${count}회 체크 · <span class="track-who">${who ? esc(who.textContent) : ''}</span>`;
  }

  /* ── 내 노트 기록 ─────────────────────────────────────── */
  function noteEntries(records, programs) {
    const out = [];
    programs.forEach((program) => {
      const bucket = (records && records[program.id]) || {};
      Object.keys(bucket).forEach((weekKey) => {
        const rec = bucket[weekKey] || {};
        const note = String(rec.note || '');
        if (!note.trim()) return;
        out.push({ program, weekKey, note, counts: onlineCounts(program, rec) });
      });
    });
    return out.sort((a, b) => {
      if (a.weekKey !== b.weekKey) return a.weekKey < b.weekKey ? 1 : -1;
      return a.program.id.localeCompare(b.program.id);
    });
  }

  function noteLogHTML(records, programs) {
    const entries = noteEntries(records, programs);
    const many = programs.length > 1;
    const head = `
      <div class="nl-head">
        <h4>내 노트 기록 <span>my notes</span></h4>
        <span class="nl-count">${entries.length ? `${entries.length}주` : ''}</span>
      </div>`;

    if (!entries.length) {
      return `
      <section class="note-log" id="noteLog" aria-label="내 노트 기록">
        ${head}
        <p class="note-empty">아직 작성한 노트가 없어요. 위에 오늘 몸의 느낌을 적고 <b>노트 저장</b>을 누르면 여기에 쌓입니다.</p>
      </section>`;
    }

    return `
      <section class="note-log" id="noteLog" aria-label="내 노트 기록">
        ${head}
        <ul class="note-list">
          ${entries.map((entry) => `
            <li>
              <button class="note-card" type="button"
                data-open-week="${esc(entry.weekKey)}"
                data-open-program="${esc(entry.program.id)}"
                aria-label="${esc(weekKeyLabel(entry.weekKey))} 노트 열어 수정하기">
                <span class="nc-top">
                  <span class="nc-week">${esc(weekKeyLabel(entry.weekKey))}</span>
                  ${many ? `<span class="nc-prog">${esc(entry.program.name)}</span>` : ''}
                </span>
                <span class="nc-sum">${entry.counts.checked}/${entry.counts.total} 동작 · ${entry.counts.count}회 체크</span>
                <span class="nc-body">${esc(entry.note)}</span>
              </button>
            </li>`).join('')}
        </ul>
      </section>`;
  }

  async function refreshNoteLog() {
    const current = $('#noteLog');
    if (!current || !UI.studentId) return;
    const records = await api.getOnline(UI.studentId);
    const holder = document.createElement('div');
    holder.innerHTML = noteLogHTML(records, allowedPrograms());
    const fresh = holder.firstElementChild;
    if (fresh) current.replaceWith(fresh);
  }

  async function saveOnlineNote(silent) {
    const area = $('#onlineNote');
    if (!area || !UI.studentId) return null;
    try {
      const rec = await api.setOnlineNote(UI.studentId, UI.onlineProgram, currentWeekKey(), area.value);
      const status = $('#noteStatus');
      if (status) status.textContent = `저장됨 · ${timeHM(new Date())}`;
      await refreshNoteLog();
      if (!silent) toast('노트를 저장했어요.');
      return rec;
    } catch (err) {
      toast(err.message || '노트를 저장하지 못했어요.', true);
      return null;
    }
  }

  function bindOnline() {
    const panel = $('#trackPanel');
    if (!panel) return;

    panel.addEventListener('click', async (event) => {
      const tab = event.target.closest('[data-program]');
      if (tab) {
        UI.onlineProgram = tab.dataset.program;
        UI.onlinePicked = true;
        await renderOnline();
        return;
      }

      /* 노트 카드 → 그 주차 · 프로그램으로 이동해 바로 수정 */
      const card = event.target.closest('[data-open-week]');
      if (card) {
        UI.onlineProgram = card.dataset.openProgram || UI.onlineProgram;
        UI.onlineWeek = card.dataset.openWeek || null;
        UI.onlinePicked = true;
        await renderOnline();
        const noteBox = $('.track-note');
        if (noteBox) noteBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const tick = event.target.closest('[data-tick]');
      if (tick && UI.studentId) {
        if (tick.dataset.busy === '1') return;
        const [movementId, dayStr] = tick.dataset.tick.split(':');
        const on = !tick.classList.contains('is-on');
        tick.dataset.busy = '1';
        try {
          const rec = await api.setOnlineCheck(
            UI.studentId, UI.onlineProgram,
            currentWeekKey(), movementId, Number(dayStr), on,
          );
          tick.classList.toggle('is-on', on);
          tick.setAttribute('aria-pressed', on ? 'true' : 'false');
          tick.textContent = on ? '✓' : '';
          refreshTrackSummary(rec);
          await refreshNoteLog();
        } catch (err) {
          toast(err.message || '체크를 저장하지 못했어요.', true);
        }
        delete tick.dataset.busy;
        return;
      }

      if (event.target.closest('[data-save-note]')) {
        await saveOnlineNote(false);
      }
    });

    panel.addEventListener('change', async (event) => {
      if (event.target.id !== 'onlineWeek') return;
      UI.onlineWeek = event.target.value || null;
      await renderOnline();
    });

    panel.addEventListener('focusout', async (event) => {
      if (event.target.id === 'onlineNote' && UI.studentId) await saveOnlineNote(true);
    });
  }

  /* ── sequence ──────────────────────────────────────────── */
  function stepHTML(item, index, group) {
    return `
      <li class="step">
        <div class="step-num">${pad2(index + 1)}</div>
        <div class="step-body">
          <h4 class="step-name">
            ${esc(item.name)}
            ${item.tags && item.tags.length ? `<span class="step-tag">${esc(item.tags.join(' · '))}</span>` : ''}
          </h4>
          <p class="step-cue">${esc(item.cue)}</p>
          <div class="step-foot">
            <span class="step-dose">${esc(item.dose)}</span>
            <button class="btn-video" type="button" data-video="${esc(item.id)}">
              영상 보기
              <svg viewBox="0 0 9 10" aria-hidden="true"><path d="M0 0l9 5-9 5z" fill="currentColor"></path></svg>
            </button>
          </div>
        </div>
      </li>`;
  }

  function renderSequence() {
    const warm = $('#warmupList');
    if (warm) warm.innerHTML = WARMUP.map((item, i) => stepHTML(item, i, 'warm-up')).join('');

    const list = $('#seqList');
    if (list) {
      const items = SEQUENCES[UI.level] || [];
      list.innerHTML = items.map((item, i) => stepHTML(item, i, UI.level)).join('');
    }

    const count = $('#seqCount');
    if (count) count.textContent = `${(SEQUENCES[UI.level] || []).length} movements · P3`;

    $$('.seq-tab').forEach((tab) => {
      const on = tab.dataset.level === UI.level;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  /* ── 영상 모달 ─────────────────────────────────────────── */
  const VIDEO_INDEX = new Map();
  WARMUP.forEach((item) => VIDEO_INDEX.set(item.id, { item, group: 'warm-up' }));
  Object.keys(SEQUENCES).forEach((level) => {
    SEQUENCES[level].forEach((item) => VIDEO_INDEX.set(item.id, { item, group: level }));
  });
  /* 온라인 클래스 동작도 같은 영상 모달을 씁니다 */
  Object.values(ONLINE).forEach((program) => {
    program.movements.forEach((item) => {
      if (!VIDEO_INDEX.has(item.id)) VIDEO_INDEX.set(item.id, { item, group: program.name });
    });
  });

  function youtubeId(video) {
    if (!video) return '';
    const raw = String(video.youtubeId || '').trim();
    if (/^[\w-]{6,20}$/.test(raw)) return raw;
    const source = String(video.url || raw || '').trim();
    const match = source.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{6,20})/);
    return match ? match[1] : '';
  }

  function openVideo(id) {
    const entry = VIDEO_INDEX.get(id);
    const modal = $('#videoModal');
    if (!entry || !modal) return;

    const { item, group } = entry;
    const frame = $('#videoFrame');
    const link = $('#videoLink');
    const hint = $('#videoHint');
    const yt = youtubeId(item.video);

    $('#videoTitle').textContent = item.name;
    $('#videoLevel').textContent = group;

    if (yt) {
      frame.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(yt)}?autoplay=1&rel=0"
        title="${esc(item.name)} 영상" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen></iframe>`;
      link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(yt)}`;
      link.hidden = false;
      hint.textContent = `동작 · ${item.dose}`;
    } else {
      frame.innerHTML = `
        <div class="video-empty">
          <strong>영상 준비 중입니다</strong>
          <p>${esc(item.name)} · ${esc(item.dose)}<br>유튜브 링크를 연결하면 이 자리에서 바로 재생됩니다.</p>
        </div>`;
      link.hidden = true;
      hint.textContent = '링크는 data.js의 video 항목에서 연결합니다.';
    }

    modal.showModal();
  }

  function closeVideo() {
    const modal = $('#videoModal');
    if (!modal) return;
    const frame = $('#videoFrame');
    if (frame) frame.innerHTML = '';
    modal.close();
  }

  /* ── 강사 모드 ─────────────────────────────────────────── */
  function requestTypeLabel(type) {
    return type === 'renewal' ? '재등록 요청' : '신규 등록 신청';
  }

  /* 수업 4가지 체크박스 — 강사가 열어 줄 수업을 고릅니다 */
  function classPicksHTML(classes, attr, id) {
    const picked = classes || [];
    return `<div class="cls-picks" ${attr}="${esc(id)}">${CLASSES.map((cls) => `
      <label class="cls-pick">
        <input type="checkbox" value="${esc(cls.id)}"${picked.indexOf(cls.id) !== -1 ? ' checked' : ''}>
        <span>${esc(CLASS_SHORT[cls.id] || cls.name)}</span>
      </label>`).join('')}</div>`;
  }

  function adminStudentsHTML(students) {
    const rows = students.map((s) => {
      const pass = s.pass ? `${s.pass.label} ${s.pass.remaining}/${s.pass.total}` : '수강권 없음';
      const statusLabel = {
        active: '사용 중',
        new: '신규',
        pending: '요청 확인 중',
        exhausted: '소진/만료',
      }[s.status] || s.status;
      return `
        <tr>
          <td class="stu-cell">
            <span class="stu-cell-name">${esc(s.name)}</span>
            <span class="req-sub">${esc(s.code)}</span>
            <span class="stu-cell-meta">
              <span class="pill${s.status === 'active' ? ' is-active' : ''}">${esc(statusLabel)}</span>
              <span>${esc(pass)}</span>
            </span>
          </td>
          <td class="cls-cell">${classPicksHTML(s.classes, 'data-cls-student', s.id)}</td>
        </tr>`;
    }).join('');

    return `
      <table class="stu-table stu-table--cls">
        <thead><tr><th>수강생 · 수강권</th><th>열린 수업</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* 예약 한 건 — 이름 + 강사는 언제든 누를 수 있는 취소 버튼 */
  function adminBookingHTML(booking, session) {
    const start = new Date(session.startISO);
    const label = `${booking.name} · ${shortDate(start)} ${timeHM(start)}`;
    const tags = [];
    if (booking.by === 'instructor') tags.push('<span class="bk-tag">강사 예약</span>');
    if (session.late) tags.push('<span class="bk-tag is-late">취소 마감</span>');
    return `
      <li class="bk-item">
        <span class="bk-name">${esc(booking.name)}</span>
        ${tags.join('')}
        <button class="btn-mini btn-mini--x" type="button"
          data-admin-cancel="${esc(booking.id)}"
          data-bk-label="${esc(label)}"
          aria-label="${esc(booking.name)} 예약 취소">취소</button>
      </li>`;
  }

  function adminDaysHTML(days) {
    if (!days.length) return '<p class="admin-empty">예정된 수업이 없습니다.</p>';
    return days.map((day) => {
      const date = new Date(day.startISO);
      const sessions = day.sessions.map((session) => {
        const start = new Date(session.startISO);
        const end = new Date(session.endISO);
        const list = session.bookings.length
          ? `<ul class="bk-list">${session.bookings.map((b) => adminBookingHTML(b, session)).join('')}</ul>`
          : '<p class="day-names">예약 없음</p>';
        return `
          <div class="day-session">
            <div class="ds-head">
              <strong>${timeHM(start)}–${timeHM(end)} · ${esc(session.className)}</strong>
              <span class="ds-count">${session.bookings.length}명</span>
            </div>
            ${list}
          </div>`;
      }).join('');

      return `
        <details class="day">
          <summary>
            <span>${midDate(date)}</span>
            <span class="day-count">${day.sessions.length}개 수업 · ${day.booked}건</span>
          </summary>
          <div class="day-body">${sessions}</div>
        </details>`;
    }).join('');
  }

  /* 대리 예약 폼 — 수강권이 살아 있고 오프라인 수업이 열린 수강생 + 그 수강생의 수업만 */
  function sessionOptionsHTML(data, studentId) {
    const student = data.students.find((s) => s.id === studentId);
    const classes = (student && student.classes) || [];
    return data.days.map((day) => {
      const items = day.sessions.filter((s) => s.bookable && classes.indexOf(s.classId) !== -1);
      if (!items.length) return '';
      const date = new Date(day.startISO);
      return `<optgroup label="${esc(midDate(date))}">${items.map((s) => {
        const start = new Date(s.startISO);
        const taken = s.bookings.some((b) => b.studentId === studentId);
        return `<option value="${esc(s.id)}"${s.id === UI.adminSession ? ' selected' : ''}>${timeHM(start)} ${esc(s.className)}${taken ? ' · 예약됨' : ''}</option>`;
      }).join('')}</optgroup>`;
    }).join('');
  }

  function adminBookHTML(data) {
    const students = data.students.filter(
      (s) => s.status === 'active' && (s.classes || []).some((c) => OFFLINE_CLASS_IDS.indexOf(c) !== -1),
    );
    if (!students.length) {
      return '<p class="admin-empty">지금 대리 예약을 넣을 수 있는 수강생이 없어요. 수강권을 부여하고 오프라인 수업을 열어 주세요.</p>';
    }

    const picked = students.some((s) => s.id === UI.adminStudent) ? UI.adminStudent : students[0].id;
    UI.adminStudent = picked;

    const studentOptions = students.map((s) => {
      const p = s.pass;
      const remain = p ? ` (${p.remaining}회 남음)` : '';
      return `<option value="${esc(s.id)}"${s.id === picked ? ' selected' : ''}>${esc(s.name)} · ${esc(s.code)}${esc(remain)}</option>`;
    }).join('');

    const sessionOptions = sessionOptionsHTML(data, picked);
    if (!sessionOptions.trim()) {
      return '<p class="admin-empty">아직 시작하지 않은 수업이 없어요.</p>';
    }

    return `
      <div class="book-row">
        <select class="select" id="bookStudent" aria-label="대리 예약할 수강생">${studentOptions}</select>
        <select class="select" id="bookSession" aria-label="대리 예약할 수업">${sessionOptions}</select>
        <button class="btn-mini btn-mini--butter" type="button" data-admin-book>대리 예약</button>
      </div>
      <p class="grant-hint">고른 수강생의 잔여 횟수에서 1회 차감되고, 수강생 화면에 바로 반영됩니다. 만료·소진·중복·같은 시간 예약은 그대로 막힙니다.</p>`;
  }

  function adminOnlineHTML(rows) {
    if (!rows || !rows.length) return '<p class="admin-empty">이번 주 온라인 체크 기록이 없어요.</p>';
    return rows.map((row) => `
      <div class="on-row">
        <div class="on-head"><b>${esc(row.name)}</b></div>
        ${row.items.map((it) => `
          <div class="on-item">
            <span class="on-prog">${esc(it.programName)}</span>
            <span class="on-count">${it.checked}/${it.total} 동작 · ${it.count}회</span>
            <p class="on-note${it.note ? '' : ' is-empty'}">${it.note ? esc(it.note) : '노트 없음'}</p>
          </div>`).join('')}
      </div>`).join('');
  }

  let ADMIN_DATA = null;

  async function renderAdmin() {
    const body = $('#adminBody');
    if (!body) return;
    const data = await api.adminData();
    ADMIN_DATA = data;

    const requests = data.pending.length
      ? data.pending.map((req) => `
          <div class="req-row">
            <div class="req-main">
              <b>${esc(req.studentName)}</b> · ${esc(requestTypeLabel(req.type))}
              <span class="req-sub">${fullDate(new Date(req.createdAt))} ${timeHM(new Date(req.createdAt))}</span>
            </div>
            <div class="req-act">
              ${classPicksHTML(req.classes, 'data-req-cls', req.id)}
              <select class="select" data-req-type="${esc(req.id)}" aria-label="부여할 수강권">
                <option value="4">4회권</option>
                <option value="8">8회권</option>
              </select>
              <button class="btn-mini btn-mini--butter" type="button" data-approve="${esc(req.id)}">승인 · 개시</button>
            </div>
          </div>`).join('')
      : '<p class="admin-empty">확인할 요청이 없어요.</p>';

    const studentOptions = data.students
      .map((s) => `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.code)}</option>`)
      .join('');

    body.innerHTML = `
      <section class="admin-block">
        <div class="admin-h"><h4>요청 / requests</h4><span>${data.pending.length}건</span></div>
        ${requests}
      </section>

      <section class="admin-block">
        <div class="admin-h"><h4>새 회원 / new</h4><span>열 수업 체크</span></div>
        <div class="reg-row">
          <input class="reg-input" id="regName" type="text" placeholder="이름" aria-label="새 회원 이름">
          <input class="reg-input" id="regCode" type="text" placeholder="수강 코드 (MJ-3001)" aria-label="새 회원 수강 코드">
        </div>
        ${classPicksHTML([], 'data-reg-cls', 'new')}
        <div class="reg-row">
          <select class="select" id="regPass" aria-label="수강권 종류">
            <option value="">수강권 없음</option>
            <option value="4">4회권 · 60일</option>
            <option value="8">8회권 · 90일</option>
          </select>
          <button class="btn-mini btn-mini--butter" type="button" data-register>회원 등록</button>
        </div>
        <p class="grant-hint">체크한 수업만 회원 화면에 보입니다. 오프라인 수업(핸드스탠드·펑셔널)은 수강권이 있어야 예약할 수 있고, 온라인 수업은 체크·노트가 열립니다.</p>
      </section>

      <section class="admin-block">
        <div class="admin-h"><h4>수강생 · 수업 / students</h4><span>${data.students.length}명</span></div>
        <p class="grant-hint">체크를 바꾸면 그 수강생의 화면에 바로 반영됩니다.</p>
        ${adminStudentsHTML(data.students)}
      </section>

      <section class="admin-block">
        <div class="admin-h"><h4>수강권 부여 / grant</h4><span></span></div>
        <div class="grant-row">
          <select class="select" id="grantStudent" aria-label="수강생">${studentOptions}</select>
          <select class="select" id="grantType" aria-label="수강권 종류">
            <option value="4">4회권 · 60일</option>
            <option value="8">8회권 · 90일</option>
          </select>
          <button class="btn-mini btn-mini--butter" type="button" data-grant>부여</button>
        </div>
        <p class="grant-hint">부여하면 잔여 횟수가 새로 시작됩니다. 이미 사용 중인 수강권이 있으면 새 수강권으로 교체되고, 남은 횟수는 넘어가지 않아요.</p>
      </section>

      <section class="admin-block">
        <div class="admin-h"><h4>온라인 체크 / online</h4><span>이번 주</span></div>
        ${adminOnlineHTML(data.online)}
      </section>

      <section class="admin-block">
        <div class="admin-h"><h4>대리 예약 / book</h4><span>강사 권한</span></div>
        ${adminBookHTML(data)}
      </section>

      <section class="admin-block">
        <div class="admin-h"><h4>예약 현황 / schedule</h4><span>오늘부터 ${CONFIG.bookingWindowDays}일</span></div>
        <p class="grant-hint">예약 옆 취소는 강사 권한입니다. 수강생의 1시간 전 마감과 상관없이 취소되고 횟수가 돌아갑니다.</p>
        ${adminDaysHTML(data.days)}
      </section>

      <div class="admin-foot">
        <p>데모 데이터는 이 브라우저에 저장됩니다.</p>
        <button class="text-btn" type="button" data-reset>데모 초기화</button>
      </div>`;
  }

  function bindAdmin() {
    const openers = $$('[data-open-admin]');
    const modal = $('#adminModal');
    if (!modal) return;

    openers.forEach((btn) => {
      btn.addEventListener('click', async () => {
        UI.resetArmed = false;
        await renderAdmin();
        modal.showModal();
      });
    });

    const body = $('#adminBody');
    body.addEventListener('change', async (event) => {
      const studentSelect = event.target.closest('#bookStudent');
      if (studentSelect) {
        UI.adminStudent = studentSelect.value;
        UI.adminSession = '';
        const sessionSelect = $('#bookSession');
        if (sessionSelect && ADMIN_DATA) {
          sessionSelect.innerHTML = sessionOptionsHTML(ADMIN_DATA, UI.adminStudent);
        }
        return;
      }

      /* 수강생 수업 체크/해제 → 바로 저장 */
      const classBox = event.target.closest('[data-cls-student] input[type="checkbox"]');
      if (classBox) {
        const holder = classBox.closest('[data-cls-student]');
        const studentId = holder.dataset.clsStudent;
        const classes = Array.from(holder.querySelectorAll('input:checked')).map((x) => x.value);
        try {
          const v = await api.adminSetClasses(studentId, classes);
          await renderAdmin();
          await renderBooking();
          toast(`${v.name}님 수업 ${classes.length}개로 저장했어요.`);
        } catch (err) {
          toast(err.message || '수업을 바꾸지 못했어요.', true);
        }
      }
    });

    body.addEventListener('click', async (event) => {
      const bookBtn = event.target.closest('[data-admin-book]');
      if (bookBtn) {
        const studentId = ($('#bookStudent') || {}).value;
        const sessionId = ($('#bookSession') || {}).value;
        if (!studentId || !sessionId) {
          toast('수강생과 수업을 골라 주세요.', true);
          return;
        }
        UI.adminSession = sessionId;
        bookBtn.disabled = true;
        try {
          const v = await api.adminBook(studentId, sessionId);
          const session = (await api.listSessions()).find((s) => s.id === sessionId);
          await renderAdmin();
          await renderBooking();
          toast(session
            ? `${v.name}님 대리 예약 · ${shortDate(new Date(session.startISO))} ${timeHM(new Date(session.startISO))}`
            : `${v.name}님 대리 예약을 넣었어요.`);
        } catch (err) {
          bookBtn.disabled = false;
          toast(err.message || '대리 예약을 넣지 못했어요.', true);
        }
        return;
      }

      const adminCancelBtn = event.target.closest('[data-admin-cancel]');
      if (adminCancelBtn) {
        const label = adminCancelBtn.dataset.bkLabel || '';
        adminCancelBtn.disabled = true;
        try {
          await api.adminCancel(adminCancelBtn.dataset.adminCancel);
          await renderAdmin();
          await renderBooking();
          toast(label ? `예약을 취소했어요 · ${label} (횟수 1회 복구)` : '예약을 취소했어요. 횟수가 돌아왔습니다.');
        } catch (err) {
          adminCancelBtn.disabled = false;
          toast(err.message || '취소하지 못했어요.', true);
        }
        return;
      }

      const approveBtn = event.target.closest('[data-approve]');
      if (approveBtn) {
        const id = approveBtn.dataset.approve;
        const select = body.querySelector(`[data-req-type="${id}"]`);
        const type = select ? select.value : '4';
        const holder = body.querySelector(`[data-req-cls="${id}"]`);
        const classes = holder
          ? Array.from(holder.querySelectorAll('input:checked')).map((x) => x.value)
          : undefined;
        try {
          await api.approveRequest(id, type, classes);
          await renderAdmin();
          await renderBooking();
          toast('수강권과 수업을 열었어요.');
        } catch (err) {
          toast(err.message, true);
        }
        return;
      }

      const registerBtn = event.target.closest('[data-register]');
      if (registerBtn) {
        const name = ($('#regName') || {}).value || '';
        const code = ($('#regCode') || {}).value || '';
        const passType = ($('#regPass') || {}).value || '';
        const holder = body.querySelector('[data-reg-cls]');
        const classes = holder
          ? Array.from(holder.querySelectorAll('input:checked')).map((x) => x.value)
          : [];
        registerBtn.disabled = true;
        try {
          const v = await api.adminRegister({ name, code, classes, passType });
          await renderAdmin();
          await renderBooking();
          toast(`${v.name}님을 등록했어요 · 열린 수업 ${v.classes.length}개`);
        } catch (err) {
          registerBtn.disabled = false;
          toast(err.message || '회원을 등록하지 못했어요.', true);
        }
        return;
      }

      const grantBtn = event.target.closest('[data-grant]');
      if (grantBtn) {
        const studentId = $('#grantStudent').value;
        const type = $('#grantType').value;
        try {
          await api.grantPass(studentId, type);
          await renderAdmin();
          await renderBooking();
          toast('수강권을 부여했어요.');
        } catch (err) {
          toast(err.message, true);
        }
        return;
      }

      const resetBtn = event.target.closest('[data-reset]');
      if (resetBtn) {
        if (!UI.resetArmed) {
          UI.resetArmed = true;
          resetBtn.textContent = '한 번 더 누르면 초기화됩니다';
          return;
        }
        await api.reset();
        UI.resetArmed = false;
        UI.studentId = null;
        saveCurrent();
        await renderAdmin();
        await renderBooking();
        toast('데모 데이터를 초기화했어요.');
      }
    });
  }

  /* ── 모달 공통 ─────────────────────────────────────────── */
  function bindModals() {
    const videoModal = $('#videoModal');
    const adminModal = $('#adminModal');

    if (videoModal) {
      videoModal.addEventListener('click', (event) => {
        if (event.target.closest('[data-close-video]')) closeVideo();
        if (event.target === videoModal) closeVideo();
      });
      videoModal.addEventListener('close', () => {
        const frame = $('#videoFrame');
        if (frame) frame.innerHTML = '';
      });
    }

    if (adminModal) {
      adminModal.addEventListener('click', (event) => {
        if (event.target.closest('[data-close-admin]') || event.target === adminModal) adminModal.close();
      });
    }

    document.addEventListener('click', (event) => {
      const vidBtn = event.target.closest('[data-video]');
      if (vidBtn) openVideo(vidBtn.dataset.video);
    });

    $$('.seq-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        UI.level = tab.dataset.level;
        renderSequence();
      });
    });
  }

  /* ── 현재 섹션 표시 ────────────────────────────────────── */
  function bindScrollSpy() {
    const links = $$('.head-nav a');
    const map = new Map();
    links.forEach((link) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) map.set(target, link);
    });
    if (!map.size || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((l) => l.classList.remove('is-current'));
        const active = map.get(entry.target);
        if (active) active.classList.add('is-current');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    map.forEach((_, target) => observer.observe(target));
  }

  /* ── 시작 ──────────────────────────────────────────────── */
  async function init() {
    UI.studentId = loadCurrent();
    UI.onlinePicked = false;
    renderClasses();
    renderSequence();
    renderDemoSwitch();
    bindBooking();
    bindOnline();
    bindAdmin();
    bindModals();
    bindScrollSpy();
    await renderBooking();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
