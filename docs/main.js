/* =========================================================
   PotolokPro — демо-лендинг
   Все настройки клиента — в CONFIG ниже. Меняешь здесь — меняется везде.
   ========================================================= */

const CONFIG = {
  brand: 'ПотолокПро',
  phone: '+7 (978) 000-00-00',
  phoneRaw: '+79780000000',
  whatsapp: '79780000000',
  email: 'info@example.ru',

  // Заявки уходят на наш сервер → письмо владельцу.
  // Секретов в клиентском коде НЕТ (токены живут в .env на сервере).
  // GitHub Pages = статика, своего сервера нет.
  // Заявки принимает Formspree (бесплатно, приходят на почту).
  // 1) Зарегистрируйтесь на https://formspree.io (бесплатный план)
  // 2) Создайте форму, скопируйте её ID
  // 3) Вставьте сюда: 'https://formspree.io/f/ВАШ_ID'
  // Пока пусто — форма работает в демо-режиме (ничего не отправляется).
  formspreeUrl: '',

  // Яндекс.Метрика (вставь номер счётчика, 0 = выкл)
  metrikaId: 0,
};

/* ---------- Калькулятор: тарифы ---------- */
const PRICES = {
  area: {
    small:  { label: 'до 15 м²',   base: 14, coef: 1.0 },
    mid:    { label: '15–25 м²',   base: 22, coef: 0.97 },
    large:  { label: '25–40 м²',   base: 34, coef: 0.94 },
    xl:     { label: 'более 40 м²', base: 48, coef: 0.9 },
  },
  type: {
    matte:  { label: 'Матовый',   price: 390 },
    satin:  { label: 'Сатиновый', price: 430 },
    gloss:  { label: 'Глянцевый', price: 450 },
    float:  { label: 'Парящий',   price: 890 },
  },
  lights: {
    none:  { label: 'Без светильников', add: 0 },
    four:  { label: '4 светильника',    add: 1800 },
    eight: { label: '8 светильников',   add: 3600 },
    many:  { label: 'Более 8',          add: 5400 },
  },
};

/* =========================================================
   Утилиты
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function applyConfig() {
  $$('[data-cfg]').forEach(el => {
    const key = el.dataset.cfg;
    if (CONFIG[key]) el.textContent = CONFIG[key];
  });
  $$('a[href^="tel:"]').forEach(a => a.href = 'tel:' + CONFIG.phoneRaw);
  $$('a[href^="https://wa.me/"]').forEach(a => a.href = 'https://wa.me/' + CONFIG.whatsapp);
}

const fmt = n => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3800);
}

/* ---------- Телефон ---------- */
function normalizePhone(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
}
function isValidPhone(raw) {
  const d = normalizePhone(raw);
  return d.length === 11 && d.startsWith('7');
}
function maskPhone(input) {
  input.addEventListener('input', () => {
    let d = input.value.replace(/\D/g, '');
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (d && !d.startsWith('7')) d = '7' + d;
    d = d.slice(0, 11);
    let out = '';
    if (d.length) out = '+7';
    if (d.length > 1) out += ' (' + d.slice(1, 4);
    if (d.length >= 5) out += ') ' + d.slice(4, 7);
    if (d.length >= 8) out += '-' + d.slice(7, 9);
    if (d.length >= 10) out += '-' + d.slice(9, 11);
    input.value = out;
    input.classList.remove('is-error');
    const err = input.parentElement.querySelector('.field__err');
    if (err) err.classList.remove('show');
  });
}

/* =========================================================
   Квиз
   ========================================================= */
const state = { area: null, type: null, lights: null };

const STEPS = [
  {
    key: 'area',
    q: 'Какая площадь помещения?',
    options: Object.entries(PRICES.area).map(([k, v]) => ({ key: k, title: v.label, sub: '' })),
  },
  {
    key: 'type',
    q: 'Какой тип потолка вам нравится?',
    options: Object.entries(PRICES.type).map(([k, v]) => ({ key: k, title: v.label, sub: 'от ' + v.price + ' ₽/м²' })),
  },
  {
    key: 'lights',
    q: 'Сколько точечных светильников нужно?',
    options: Object.entries(PRICES.lights).map(([k, v]) => ({
      key: k, title: v.label, sub: v.add ? '+' + fmt(v.add) : 'включено',
    })),
  },
];

let stepIndex = 0;

function renderStep() {
  const step = STEPS[stepIndex];
  $('#quizStep').textContent = `Шаг ${stepIndex + 1} из 4`;
  $('#quizBar').style.width = ((stepIndex + 1) / 4 * 100) + '%';
  $('#quizQ').textContent = step.q;

  const box = $('#quizOptions');
  box.innerHTML = '';
  step.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'opt' + (state[step.key] === opt.key ? ' is-active' : '');
    btn.innerHTML = `<span>${opt.title}</span>${opt.sub ? `<small>${opt.sub}</small>` : ''}`;
    btn.addEventListener('click', () => {
      state[step.key] = opt.key;
      $$('.opt', box).forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      setTimeout(nextStep, 160);
    });
    box.appendChild(btn);
  });

  $('#quizBack').hidden = stepIndex === 0;
}

function nextStep() {
  if (stepIndex < STEPS.length - 1) {
    stepIndex++;
    renderStep();
  } else {
    showResult();
  }
}

function calcPrice() {
  const a = PRICES.area[state.area];
  const t = PRICES.type[state.type];
  const l = PRICES.lights[state.lights];
  if (!a || !t || !l) return 0;
  return (a.base * t.price * a.coef) + l.add;
}

function showResult() {
  $('#quizStep').textContent = 'Готово';
  $('#quizBar').style.width = '100%';
  $('#quizBody').hidden = true;
  $('#quizResult').hidden = false;
  $('#quizSum').textContent = fmt(calcPrice());
  try { $('#qName').focus({ preventScroll: true }); } catch (e) {}
}

function resetQuiz() {
  state.area = state.type = state.lights = null;
  stepIndex = 0;
  $('#quizResult').hidden = true;
  $('#quizBody').hidden = false;
  renderStep();
}

/* =========================================================
   Отправка заявки
   ========================================================= */
async function sendLead(payload) {
  // Метрика (если настроена)
  if (CONFIG.metrikaId && window.ym) {
    try { window.ym(CONFIG.metrikaId, 'reachGoal', 'lead'); } catch (e) {}
  }

  // Без настроенной формы честно сообщаем, что отправить некуда
  if (!CONFIG.formspreeUrl) {
    console.info('[ДЕМО] Заявка (Formspree не подключён):', payload);
    return { ok: false, demo: true, error: 'Форма не подключена' };
  }

  try {
    const res = await fetch(CONFIG.formspreeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: 'Не удалось отправить заявку' };
    return { ok: true };
  } catch (err) {
    console.error('Ошибка отправки:', err);
    return { ok: false, error: 'Нет связи с сервисом отправки' };
  }
}

/* =========================================================
   Галерея «до/после»: ползунок + лайтбокс
   ========================================================= */
function initBeforeAfter() {
  $$('.ba').forEach(fig => {
    const stage = $('.ba__stage', fig);
    const after = $('.ba__after', fig);
    const handle = $('.ba__handle', fig);
    if (!stage || !after || !handle) return;

    // начальное состояние — ровно 50%
    after.style.clipPath = 'inset(0 0 0 50%)';
    handle.style.left = '50%';

    let dragging = false;

    const setPos = (clientX) => {
      const r = stage.getBoundingClientRect();
      let p = ((clientX - r.left) / r.width) * 100;
      p = Math.max(0, Math.min(100, p));
      after.style.clipPath = `inset(0 0 0 ${p}%)`;
      handle.style.left = p + '%';
    };

    const start = (e) => {
      dragging = true;
      setPos(e.touches ? e.touches[0].clientX : e.clientX);
    };
    const move = (e) => {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      setPos(e.touches ? e.touches[0].clientX : e.clientX);
    };
    const end = () => { dragging = false; };

    stage.addEventListener('mousedown', start);
    stage.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);

    // Клик по ползунку — просто двигает его туда, куда нажали
    stage.addEventListener('click', (e) => {
      if (Math.abs(e.offsetX / stage.clientWidth * 100 - parseFloat(handle.style.left || 50)) > 1) return;
    });
  });
}

function initLightbox() {
  const lb = $('#lightbox');
  if (!lb) return;
  const lbImg = $('#lbImg');
  const lbCap = $('#lbCap');

  const items = $$('.ba').map(fig => ({
    after: $('.ba__after', fig)?.getAttribute('src') || '',
    before: $('.ba', fig)?.querySelector('.ba__img')?.getAttribute('src') || '',
    caption: fig.dataset.caption || '',
  }));

  let cur = 0;
  const open = (i) => {
    cur = (i + items.length) % items.length;
    lbImg.src = items[cur].after;
    lbImg.alt = items[cur].caption;
    lbCap.textContent = items[cur].caption + '  (после)';
    lb.classList.add('show');
    document.body.style.overflow = 'hidden';
  };
  const close = () => {
    lb.classList.remove('show');
    lbImg.src = '';
    document.body.style.overflow = '';
  };

  $$('.ba__zoom').forEach((btn, i) => btn.addEventListener('click', () => open(i)));
  $$('.ba__stage').forEach((st, i) => st.addEventListener('dblclick', () => open(i)));

  $('#lbClose').addEventListener('click', close);
  $('#lbPrev').addEventListener('click', () => open(cur - 1));
  $('#lbNext').addEventListener('click', () => open(cur + 1));
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('show')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') open(cur - 1);
    if (e.key === 'ArrowRight') open(cur + 1);
  });
}

/* =========================================================
   Инициализация
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  applyConfig();
  initBeforeAfter();
  initLightbox();

  // Квиз
  if ($('#quizBox')) {
    renderStep();
    $('#quizBack').addEventListener('click', () => {
      if (stepIndex > 0) { stepIndex--; renderStep(); }
    });

    const qPhone = $('#qPhone');
    maskPhone(qPhone);

    $('#quizForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#qName').value.trim();
      const phone = qPhone.value.trim();

      if (!isValidPhone(phone)) {
        qPhone.classList.add('is-error');
        $('#qPhoneErr').classList.add('show');
        qPhone.focus();
        return;
      }

      const btn = $('#quizSubmit');
      btn.disabled = true;
      btn.textContent = 'Отправляем…';

      const calc = `${PRICES.area[state.area].label} · ${PRICES.type[state.type].label} · ${PRICES.lights[state.lights].label} → ${fmt(calcPrice())}`;
      const res = await sendLead({ name, phone, source: 'Квиз-калькулятор', calc, area: state.area, type: state.type, lights: state.lights });

      btn.disabled = false;
      btn.textContent = 'Записаться на бесплатный замер';

      if (res.ok) {
        toast('Спасибо! Перезвоним в течение 15 минут.');
        resetQuiz();
        window.scrollTo({ top: $('#quiz').offsetTop - 80, behavior: 'smooth' });
      } else {
        toast(res.demo ? 'Демо-режим: позвоните нам — ' + CONFIG.phone : 'Заявка не ушла. Позвоните нам напрямую: ' + CONFIG.phone);
      }
    });
  }

  // Форма в CTA
  const ctaForm = $('#ctaForm');
  if (ctaForm) {
    const cPhone = $('#cPhone');
    maskPhone(cPhone);
    ctaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#cName').value.trim();
      const phone = cPhone.value.trim();

      if (!isValidPhone(phone)) {
        cPhone.classList.add('is-error');
        $('#cPhoneErr').classList.add('show');
        cPhone.focus();
        return;
      }

      const btn = ctaForm.querySelector('button[type="submit"]');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Отправляем…';

      const res = await sendLead({ name, phone, source: 'Форма заявки' });

      btn.disabled = false;
      btn.textContent = original;

      if (res.ok) {
        toast('Заявка принята! Перезвоним в течение 15 минут.');
        ctaForm.reset();
      } else {
        toast(res.demo ? 'Демо-режим: позвоните нам — ' + CONFIG.phone : 'Заявка не ушла. Позвоните нам напрямую: ' + CONFIG.phone);
      }
    });
  }

  // Cookie
  const cookie = $('#cookie');
  if (cookie && !localStorage.getItem('cookie-ok')) {
    setTimeout(() => cookie.classList.add('show'), 1200);
  }
  $('#cookieOk')?.addEventListener('click', () => {
    localStorage.setItem('cookie-ok', '1');
    cookie.classList.remove('show');
  });

  // Модалка политики
  const modal = $('#modal');
  $$('[data-privacy]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      modal.classList.add('show');
    });
  });
  $('#modalClose')?.addEventListener('click', () => modal.classList.remove('show'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('show');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modal?.classList.remove('show');
  });
});
