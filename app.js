'use strict';

/* ============================================================
   Данные и справочники
   ============================================================ */

const LS_KEY = 'potok_state_v2';
const ACCOUNT_KEY = 'potok_account_v1';
const ACTIVE_STREAM_KEY = 'potok_active_stream_v1';
const SUPABASE_CONFIG = window.POTOK_SUPABASE || {};
const sb = (SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey && window.supabase)
  ? window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey)
  : null;

const EXPENSE_CATS = [
  { id: 'food',      name: 'Продукты',      color: '#ff8a5b', emoji: '🛒' },
  { id: 'home',      name: 'Жильё',         color: '#6c8cff', emoji: '🏠' },
  { id: 'transport', name: 'Транспорт',     color: '#38bdf8', emoji: '🚌' },
  { id: 'fun',       name: 'Развлечения',   color: '#c084fc', emoji: '🎬' },
  { id: 'health',    name: 'Здоровье',      color: '#3ddc97', emoji: '💊' },
  { id: 'clothes',   name: 'Одежда',        color: '#f472b6', emoji: '👕' },
  { id: 'subs',      name: 'Подписки',      color: '#ffc857', emoji: '📱' },
  { id: 'other',     name: 'Другое',        color: '#94a3b8', emoji: '✨' },
];

const INCOME_CATS = [
  { id: 'salary',    name: 'Зарплата',      color: '#3ddc97', emoji: '💼' },
  { id: 'freelance', name: 'Фриланс',       color: '#22d3ee', emoji: '💻' },
  { id: 'gifts',     name: 'Подарки',       color: '#f472b6', emoji: '🎁' },
  { id: 'invest',    name: 'Инвестиции',    color: '#a3e635', emoji: '📈' },
  { id: 'other_in',  name: 'Другое',        color: '#94a3b8', emoji: '✨' },
];

const CAT = {};
EXPENSE_CATS.concat(INCOME_CATS).forEach(function (c) { CAT[c.id] = c; });

/* Базовые суммы хранятся в рублях. Курсы фиксированные — это демо без сети. */
const CURRENCIES = {
  RUB: { code: 'RUB', name: 'Российский рубль', short: 'RUB', symbol: '₽', rubPerUnit: 1, decimals: 0 },
  EUR: { code: 'EUR', name: 'Евро', short: 'EUR', symbol: '€', rubPerUnit: 100, decimals: 2 },
  USD: { code: 'USD', name: 'Доллар США', short: 'USD', symbol: '$', rubPerUnit: 90, decimals: 2 },
  RSD: { code: 'RSD', name: 'Сербский динар', short: 'RSD', symbol: 'дин.', rubPerUnit: 0.85, decimals: 0 },
};

const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const WASTE_PHRASES = [
  'Это ваши «ну ладно, один раз». Один раз — каждый месяц.',
  'Деньги не исчезли. Они просто ушли к кому-то другому.',
  'Самое обидное: вы даже не помните, что это было.',
  'Это могло остаться у вас в кармане. Но не осталось.',
];

/* ============================================================
   Утилиты
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const pad2 = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad2(m + 1) + '-' + pad2(d);

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseISO(s) {
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
function keyOf(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}
function currentKey() { return keyOf(new Date()); }
function monthKey(s) { return String(s).slice(0, 7); }
function todayISO() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}
function addMonthsKey(key, delta) {
  const p = key.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1 + delta, 1);
  return keyOf(d);
}
function addMonthsDateStr(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth() + n, date.getDate());
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDaysDateStr(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}
function monthLabel(key) {
  const p = key.split('-').map(Number);
  return MONTHS_NOM[p[1] - 1].charAt(0).toUpperCase() + MONTHS_NOM[p[1] - 1].slice(1) + ' ' + p[0];
}
function dateLabel(s) {
  const p = s.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  const today = startOfDay(new Date());
  const diff = Math.round((today - startOfDay(d)) / 86400000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  return p[2] + ' ' + MONTHS_GEN[p[1] - 1];
}
function fullDateLabel(s) {
  const p = s.split('-').map(Number);
  return p[2] + ' ' + MONTHS_GEN[p[1] - 1] + ' ' + p[0];
}
function daysWord(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b === 1) return 'день';
  if (b >= 2 && b <= 4) return 'дня';
  return 'дней';
}
function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function activeCurrency() {
  return CURRENCIES[(state && state.currency) || 'RUB'] || CURRENCIES.RUB;
}
function money(n, opts) {
  const info = activeCurrency();
  const raw = (Number(n) || 0) / info.rubPerUnit;
  const zero = Math.abs(raw) < (info.decimals ? 0.005 : 0.5);
  const sign = opts && opts.sign;
  const fmt = info.decimals ? nf2 : nf;
  const abs = fmt.format(Math.abs(raw)).replace(/[\u00A0\u202F]/g, ' ');
  return (raw < 0 && !zero ? '−' : (sign && !zero ? '+' : '')) + abs + ' ' + info.symbol;
}
function compactMoney(n) {
  const info = activeCurrency();
  const raw = (Number(n) || 0) / info.rubPerUnit;
  const a = Math.abs(raw);
  const s = raw < 0 ? '−' : '';
  if (a >= 1000000) return s + nf1.format(a / 1000000).replace('.', ',') + ' млн ' + info.symbol;
  if (a >= 100000) return s + nf.format(a / 1000) + ' тыс ' + info.symbol;
  return money(n);
}
function parseAmount(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/\s+/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}
function rubFromInput(v) {
  return Math.round(parseAmount(v) * activeCurrency().rubPerUnit);
}
function inputAmount(rub) {
  const info = activeCurrency();
  const v = (Number(rub) || 0) / info.rubPerUnit;
  if (!v) return '';
  if (!info.decimals) return String(Math.round(v));
  return String(Math.round(v * 100) / 100).replace('.', ',');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function numId(t) {
  const n = Number(String(t.id).replace(/[^0-9]/g, ''));
  return isFinite(n) ? n : 0;
}
function uid() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/* ============================================================
   Демо-данные
   ============================================================ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedState() {
  const txs = [];
  let seq = 1;
  const rnd = mulberry32(20261022);
  const today = new Date();

  function add(type, category, amount, y, m, day, note, waste) {
    const last = new Date(y, m + 1, 0).getDate();
    if (day > last) return;
    if (y === today.getFullYear() && m === today.getMonth() && day > today.getDate()) return;
    txs.push({
      id: 't' + (seq++),
      type: type,
      category: category,
      amount: Math.round(amount),
      date: iso(y, m, day),
      note: note || '',
      waste: waste || 0,
    });
  }

  for (let i = 4; i >= 0; i--) {
    const d0 = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = d0.getFullYear();
    const m = d0.getMonth();

    add('income', 'salary', 118000 + Math.floor(rnd() * 5) * 2000, y, m, 10, 'Зарплата');
    if (i !== 2) add('income', 'freelance', 12000 + Math.floor(rnd() * 4) * 4000, y, m, 18, 'Проект на фрилансе');
    if (i === 2) add('income', 'gifts', 15000, y, m, 12, 'Подарок на день рождения');

    add('expense', 'home', 38000, y, m, 5, 'Аренда квартиры');
    add('expense', 'home', 3200 + Math.floor(rnd() * 9) * 100, y, m, 14, 'Коммунальные');
    add('expense', 'subs', 1490, y, m, 3, 'Подписки и сервисы', 790);

    add('expense', 'food', 6200 + Math.floor(rnd() * 5) * 500, y, m, 4, 'Продукты');
    add('expense', 'food', 5400 + Math.floor(rnd() * 6) * 500, y, m, 11, 'Продукты');
    add('expense', 'food', 6800 + Math.floor(rnd() * 6) * 500, y, m, 19, 'Продукты');
    add('expense', 'food', 2100 + Math.floor(rnd() * 3) * 300, y, m, 23, 'Доставка еды', 1300);

    add('expense', 'transport', 2400, y, m, 6, 'Проездной');
    add('expense', 'transport', 1850 + Math.floor(rnd() * 4) * 250, y, m, 20, 'Такси', i % 2 === 0 ? 900 : 0);

    add('expense', 'fun', 5200, y, m, 8, 'Бар с друзьями', 2800);
    add('expense', 'fun', 1500 + Math.floor(rnd() * 3) * 300, y, m, 21, 'Кино');

    add('expense', 'health', 2100 + Math.floor(rnd() * 4) * 300, y, m, 12, 'Аптека');
    add('expense', 'clothes', 6900, y, m, 15, 'Одежда', i < 3 ? 2400 : 0);
    add('expense', 'other', 4200 + Math.floor(rnd() * 4) * 400, y, m, 17, 'Маркетплейс', i % 2 === 1 ? 1700 : 0);

    if (i === 4) add('expense', 'other', 46000, y, m, 9, 'Отпуск');
    if (i === 1) add('expense', 'other', 52000, y, m, 13, 'Новый ноутбук');
  }

  return {
    currency: 'RUB',
    transactions: txs,
    goal: {
      title: 'На отпуск',
      target: 180000,
      endDate: addMonthsDateStr(today, 7),
      initial: 45000,
      startMonth: monthKeyOfMonthsAgo(4),
      createdAt: new Date().toISOString(),
    },
  };
}

function monthKeyOfMonthsAgo(n) {
  const d = new Date();
  return keyOf(new Date(d.getFullYear(), d.getMonth() - n, 1));
}

/* ============================================================
   Состояние
   ============================================================ */

function emptyState() {
  return { currency: 'RUB', transactions: [], goal: null };
}
function normalizeState(s) {
  const out = (s && typeof s === 'object') ? s : emptyState();
  if (!Array.isArray(out.transactions)) out.transactions = [];
  if (!out.goal) out.goal = null;
  if (!CURRENCIES[out.currency]) out.currency = 'RUB';
  return out;
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.transactions)) return normalizeState(s);
    }
  } catch (e) { /* localStorage может быть недоступен */ }
  return emptyState();
}
function persistState(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s || state)); } catch (e) { /* ignore */ }
}
function persist() {
  persistState(state);
  scheduleCloudSave();
}

/* ---- облако, аккаунт и потоки ---- */

let authUser = null;
let account = null;
let streams = [];
let activeStream = null;
let cloudSaveTimer = null;
let cloudSaving = false;
let cloudDirty = false;
let realtimeChannel = null;
let inviteRef = '';
try {
  const params = new URLSearchParams(location.search);
  inviteRef = (params.get('join') || params.get('ref') || '').toUpperCase();
} catch (e) { inviteRef = ''; }

function inviteLink(code) {
  const base = location.protocol === 'file:'
    ? location.href.split('?')[0]
    : location.origin + location.pathname;
  return base + '?join=' + encodeURIComponent(code);
}

function setSyncBadge(status) {
  const el = document.getElementById('syncBadge');
  if (!el) return;
  el.className = 'sync-badge' + (status ? ' is-' + status : '');
  el.textContent = status === 'syncing' ? 'Сохраняю…' : status === 'error' ? 'Нет связи' : 'В облаке';
}

function scheduleCloudSave() {
  if (!sb || !authUser || !activeStream) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(function () {
    cloudSaveTimer = null;
    saveCloudState();
  }, 350);
}

async function saveCloudState() {
  if (!sb || !authUser || !activeStream) return;
  if (cloudSaving) { cloudDirty = true; return; }

  cloudSaving = true;
  const streamId = activeStream.id;
  const snapshot = JSON.parse(JSON.stringify(state));
  setSyncBadge('syncing');

  try {
    const { error } = await sb.from('stream_states').upsert({
      stream_id: streamId,
      state: snapshot,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stream_id' });
    if (error) throw error;
    setSyncBadge('saved');
  } catch (e) {
    console.warn('Potok cloud save:', e);
    setSyncBadge('error');
  } finally {
    cloudSaving = false;
    if (cloudDirty) {
      cloudDirty = false;
      scheduleCloudSave();
    }
  }
}

async function flushCloudSave() {
  if (cloudSaveTimer) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
  }
  if (cloudSaving) {
    cloudDirty = true;
    return;
  }
  await saveCloudState();
}

function subscribeStream() {
  if (!sb) return;
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (!activeStream) return;

  const streamId = activeStream.id;
  realtimeChannel = sb.channel('potok-stream-' + streamId)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'stream_states',
      filter: 'stream_id=eq.' + streamId,
    }, function (payload) {
      if (!payload || !payload.new || !payload.new.state) return;
      if (JSON.stringify(payload.new.state) === JSON.stringify(state)) return;
      state = normalizeState(payload.new.state);
      persistState(state);
      refresh();
    })
    .subscribe();
}

const ui = {
  tab: 'home',
  month: currentKey(),
  chartType: 'all',
  forecastDate: addDaysDateStr(new Date(), 30),
  customAmount: 30,
  customUnit: 'days',
};

/* ============================================================
   Расчёты
   ============================================================ */

function allMonths() {
  const cur = currentKey();
  let min = cur;
  state.transactions.forEach(function (t) {
    const k = monthKey(t.date);
    if (k < min) min = k;
  });
  const out = [];
  let k = min;
  let guard = 0;
  while (k <= cur && guard < 600) {
    out.push(k);
    k = addMonthsKey(k, 1);
    guard++;
  }
  return out;
}

function monthStats(key) {
  let income = 0;
  let expense = 0;
  let waste = 0;
  const byCat = {};
  const byCatIncome = {};
  const list = [];

  state.transactions.forEach(function (t) {
    if (monthKey(t.date) !== key) return;
    list.push(t);
    if (t.type === 'income') {
      income += t.amount;
      byCatIncome[t.category] = (byCatIncome[t.category] || 0) + t.amount;
    } else {
      expense += t.amount;
      byCat[t.category] = (byCat[t.category] || 0) + t.amount;
    }
    if (t.type === 'expense' && t.waste) waste += Math.min(t.waste, t.amount);
  });

  function toCats(map) {
    return Object.keys(map).map(function (id) {
      return { id: id, amount: map[id], cat: CAT[id] || CAT.other };
    }).sort(function (a, b) { return b.amount - a.amount; });
  }

  return {
    key: key,
    list: list,
    income: income,
    expense: expense,
    balance: income - expense,
    cats: toCats(byCat),
    incomeCats: toCats(byCatIncome),
    waste: waste,
    count: list.length,
  };
}

function goalStats() {
  const g = state.goal;
  if (!g) return null;

  const cur = currentKey();
  const start = g.startMonth || allMonths()[0] || cur;
  let saved = Number(g.initial) || 0;
  const accruals = [];

  allMonths().forEach(function (k) {
    if (k < start || k >= cur) return;
    const st = monthStats(k);
    if (!st.count) return;
    saved += st.balance;
    accruals.push({ key: k, value: st.balance });
  });

  const pending = monthStats(cur).balance;
  const target = Number(g.target) || 0;
  const pct = target > 0 ? saved / target : 0;
  const daysLeft = Math.ceil((parseISO(g.endDate) - startOfDay(new Date())) / 86400000);
  const monthsLeft = Math.max(1, Math.ceil(Math.max(daysLeft, 0) / 30.44));
  const remaining = Math.max(0, target - saved);

  return {
    saved: saved,
    target: target,
    pct: pct,
    pending: pending,
    accruals: accruals,
    daysLeft: daysLeft,
    monthsLeft: monthsLeft,
    remaining: remaining,
    perMonth: remaining / monthsLeft,
    done: saved >= target,
  };
}

function wasteStats() {
  const entries = state.transactions.filter(function (t) {
    return t.type === 'expense' && (t.waste || 0) > 0;
  }).sort(function (a, b) {
    return b.date.localeCompare(a.date) || numId(b) - numId(a);
  });

  let total = 0;
  let totalExpense = 0;
  state.transactions.forEach(function (t) {
    if (t.type !== 'expense') return;
    totalExpense += t.amount;
    if (t.waste) total += Math.min(t.waste, t.amount);
  });

  let periodDays = 30;
  if (entries.length) {
    const oldest = entries.reduce(function (min, t) { return t.date < min ? t.date : min; }, entries[0].date);
    const span = Math.ceil((startOfDay(new Date()) - startOfDay(parseISO(oldest))) / 86400000) + 1;
    periodDays = Math.max(30, span);
  }

  const daily = total / periodDays;

  return {
    entries: entries,
    total: total,
    totalExpense: totalExpense,
    daily: daily,
    periodDays: periodDays,
    week: daily * 7,
    month: daily * 30.44,
    year: daily * 365,
  };
}

function forecastStats(dateStr) {
  const today = startOfDay(new Date());
  let target = parseISO(dateStr);
  if (isNaN(target.getTime())) target = new Date(today);
  const days = Math.max(0, Math.ceil((target - today) / 86400000));
  const todayStr = todayISO();

  let current = 0;
  state.transactions.forEach(function (t) {
    if (t.date > todayStr) return;
    current += t.type === 'income' ? t.amount : -t.amount;
  });

  const curKey = currentKey();
  const closed = allMonths().filter(function (k) {
    return k < curKey && monthStats(k).count > 0;
  }).slice(-3);

  let avgIncome = 0;
  let avgExpense = 0;
  let basis = 0;

  if (closed.length) {
    closed.forEach(function (k) {
      const st = monthStats(k);
      avgIncome += st.income;
      avgExpense += st.expense;
    });
    avgIncome /= closed.length;
    avgExpense /= closed.length;
    basis = closed.length;
  } else if (state.transactions.length) {
    const st = monthStats(curKey);
    const dayOfMonth = Math.max(1, new Date().getDate());
    const factor = 30.44 / dayOfMonth;
    avgIncome = st.income * factor;
    avgExpense = st.expense * factor;
  }

  const income = avgIncome / 30.44 * days;
  const expense = avgExpense / 30.44 * days;
  const delta = income - expense;

  return {
    days: days,
    target: target,
    current: current,
    income: income,
    expense: expense,
    delta: delta,
    projected: current + delta,
    avgIncome: avgIncome,
    avgExpense: avgExpense,
    basis: basis,
    hasData: state.transactions.length > 0,
  };
}

function findAnomaly(key, balance) {
  const values = [];
  allMonths().forEach(function (k) {
    if (k === key) return;
    const st = monthStats(k);
    if (st.count > 0) values.push(st.balance);
  });
  if (values.length < 2) return null;

  const mean = values.reduce(function (s, v) { return s + v; }, 0) / values.length;
  const variance = values.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / values.length;
  const sd = Math.sqrt(variance);
  if (sd < 1) return null;

  const z = (balance - mean) / sd;
  if (Math.abs(z) < 1.25) return null;

  const diff = balance - mean;
  return {
    type: z > 0 ? 'up' : 'down',
    diff: diff,
    text: z > 0
      ? 'Резко выше обычного · +' + money(Math.abs(diff))
      : 'Резко ниже обычного · −' + money(Math.abs(diff)),
  };
}

function toneFor(st) {
  if (!st.count) return { color: '#8a97a8', label: 'нет операций' };
  if (st.balance > 0) return { color: '#3ddc97', label: 'остаток за месяц' };
  if (st.income > 0 && Math.abs(st.balance) < st.income * 0.12) {
    return { color: '#ffc857', label: 'небольшой минус' };
  }
  return { color: '#ff6b6b', label: 'перерасход' };
}

/* ============================================================
   Главный экран
   ============================================================ */

function renderHome() {
  const view = $('#view-home');
  const months = allMonths();
  const min = months[0];
  const max = currentKey();
  if (!months.length) months.push(currentKey());
  if (ui.month < min) ui.month = min;
  if (ui.month > max) ui.month = max;

  const key = ui.month;
  const st = monthStats(key);
  const tone = toneFor(st);
  const anomaly = ui.chartType === 'all' && st.count ? findAnomaly(key, st.balance) : null;
  const prev = addMonthsKey(key, -1);
  const next = addMonthsKey(key, 1);
  const canPrev = prev >= min;
  const canNext = next <= max;

  const isIncome = ui.chartType === 'income';
  const isExpense = ui.chartType === 'expense';
  const chartCats = isIncome ? st.incomeCats : st.cats;
  const chartTotal = isIncome ? st.income : st.expense;
  const chartWord = isIncome ? 'доходов' : 'расходов';
  const ringLabel = isIncome ? 'Доходы по категориям' : 'Расходы по категориям';

  let centerNums = '';
  let centerValue = '';
  let centerColor = tone.color;
  let centerLabel = tone.label;

  if (isIncome) {
    centerValue = '+' + money(st.income);
    centerColor = '#3ddc97';
    centerLabel = 'доходы за месяц';
  } else if (isExpense) {
    centerValue = (st.expense > 0 ? '−' : '') + money(st.expense);
    centerColor = '#ff6b6b';
    centerLabel = 'расходы за месяц';
  } else {
    centerNums = '<div class="dc-nums">' +
      '<div class="dc-mini"><span class="dot in"></span>Доход <b>' + compactMoney(st.income) + '</b></div>' +
      '<div class="dc-mini"><span class="dot out"></span>Расход <b>' + compactMoney(st.expense) + '</b></div>' +
      '</div>';
    centerValue = money(st.balance, { sign: true });
  }

  const legend = chartCats.length
    ? chartCats.map(function (c) {
      const pct = chartTotal > 0 ? Math.round(c.amount / chartTotal * 100) : 0;
      return '<div class="legend-item" title="' + esc(c.cat.name) + ' · ' + pct + '%">' +
        '<span class="ldot" style="color:' + c.cat.color + '"></span>' +
        '<span class="legend-name">' + esc(c.cat.name) + '</span>' +
        '<span class="legend-val">' + money(c.amount) + '</span>' +
        '</div>';
    }).join('')
    : '<div class="legend-empty">В этом месяце пока нет ' + chartWord + '</div>';

  const refBanner = (inviteRef && !account)
    ? '<button class="ref-banner" type="button" data-register>' +
        '<span class="rb-emoji">🎁</span>' +
        '<span class="rb-info"><b>Вас пригласили в поток</b>' +
        '<small>Код ' + esc(inviteRef) + ' · Войдите, чтобы присоединиться</small></span>' +
        '<span class="rb-arrow">→</span>' +
      '</button>'
    : '';

  view.innerHTML =
    refBanner +
    '<section class="chart-card' + (anomaly ? ' anom-' + anomaly.type : '') + '">' +
      '<div class="month-nav">' +
        '<button class="mnav" type="button" data-month="' + prev + '"' + (canPrev ? '' : ' disabled') + ' aria-label="Предыдущий месяц">‹</button>' +
        '<div class="month-label">' + monthLabel(key) + '</div>' +
        '<button class="mnav" type="button" data-month="' + next + '"' + (canNext ? '' : ' disabled') + ' aria-label="Следующий месяц">›</button>' +
      '</div>' +
      '<div class="chart-switch" role="group" aria-label="Что показать: всё, расходы или доходы">' +
        '<button type="button" data-chart="all" class="' + (ui.chartType === 'all' ? 'is-active' : '') + '">Все</button>' +
        '<button type="button" data-chart="expense" class="' + (isExpense ? 'is-active' : '') + '">− Расходы</button>' +
        '<button type="button" data-chart="income" class="' + (isIncome ? 'is-active' : '') + '">+ Доходы</button>' +
      '</div>' +
      '<div class="donut-wrap">' +
        donutSVG(chartCats, chartTotal, ringLabel) +
        '<div class="donut-center">' +
          centerNums +
          '<div class="dc-value" style="color:' + centerColor + '">' + centerValue + '</div>' +
          '<div class="dc-label">' + centerLabel + '</div>' +
        '</div>' +
      '</div>' +
      (anomaly
        ? '<div class="anom-badge ' + anomaly.type + '">' +
            (anomaly.type === 'up' ? '↗' : '↘') + ' ' + esc(anomaly.text) +
          '</div>'
        : '') +
      '<div class="legend-cap"><span>' + ringLabel + '</span><b>' + money(chartTotal) + '</b></div>' +
      '<div class="legend">' + legend + '</div>' +
    '</section>' +
    '<div class="section-head">' +
      '<div><h2>История</h2><p class="section-sub">' +
        (isIncome ? 'Только доходы за всё время' : isExpense ? 'Только расходы — нажмите, чтобы отметить лишнее' : 'Нажмите на трату, чтобы отметить лишнее') +
      '</p></div>' +
      '<div class="filters" role="group" aria-label="Фильтр операций">' +
        '<button type="button" data-chart="all" class="' + (ui.chartType === 'all' ? 'is-active' : '') + '">Все</button>' +
        '<button type="button" data-chart="income" class="' + (ui.chartType === 'income' ? 'is-active' : '') + '">Доходы</button>' +
        '<button type="button" data-chart="expense" class="' + (ui.chartType === 'expense' ? 'is-active' : '') + '">Расходы</button>' +
      '</div>' +
    '</div>' +
    renderHistory();
}

function renderForecastView() {
  const el = $('#view-forecast');
  const f = forecastStats(ui.forecastDate);
  const today = todayISO();
  const targetISO = iso(f.target.getFullYear(), f.target.getMonth(), f.target.getDate());
  const color = f.projected >= 0 ? '#3ddc97' : '#ff6b6b';
  const deltaColor = f.delta >= 0 ? '#3ddc97' : '#ff6b6b';

  const quicks = [
    { d: 7, label: '+7 дней' },
    { d: 30, label: '+30 дней' },
    { d: 90, label: '+3 месяца' },
    { d: 180, label: '+6 месяцев' },
  ];
  const quickHTML = quicks.map(function (q) {
    const dateValue = addDaysDateStr(new Date(), q.d);
    return '<button type="button" data-days="' + q.d + '" class="' + (ui.forecastDate === dateValue ? 'is-active' : '') + '">' + q.label + '</button>';
  }).join('');

  let body;
  if (!f.hasData) {
    body = '<div class="fc-value" style="color:#8a97a8;font-size:20px">Нет данных</div>' +
      '<div class="fc-sub">Добавьте доходы и расходы — прогноз построится автоматически.</div>';
  } else {
    const basisText = f.basis
      ? 'по средним за ' + f.basis + ' ' + plural(f.basis, ['месяц', 'месяца', 'месяцев'])
      : 'по текущему месяцу';
    const rate = f.days > 0 ? f.delta / f.days : 0;
    body =
      '<div class="fc-value" style="color:' + color + '">≈ ' + money(f.projected) + '</div>' +
      '<div class="fc-sub">на <b>' + fullDateLabel(targetISO) + '</b>' +
        (f.days > 0 ? ' · через ' + f.days + ' ' + daysWord(f.days) : ' · сегодня') + '</div>' +
      forecastChartSVG(f) +
      '<div class="fc-split">' +
        '<span><b class="in">+' + money(f.income) + '</b> доходы</span>' +
        '<span><b class="out">−' + money(f.expense) + '</b> расходы</span>' +
        '<span>за ' + f.days + ' ' + daysWord(f.days) + '</span>' +
      '</div>' +
      '<div class="fc-foot"><span>Оценка ' + basisText + '</span>' +
        '<span class="rate">' + (rate >= 0 ? '+' : '−') + money(Math.abs(rate)) + '/день</span></div>';
  }

  const statsHTML = f.hasData
    ? '<div class="stat-grid">' +
        '<div class="stat-card"><div class="label">Сейчас по операциям</div><div class="value">' + money(f.current) + '</div>' +
          '<div class="hint">все доходы минус расходы</div></div>' +
        '<div class="stat-card"><div class="label">Средний баланс</div>' +
          '<div class="value" style="color:' + deltaColor + '">' + money(f.avgIncome - f.avgExpense, { sign: true }) + '</div>' +
          '<div class="hint">в месяц</div></div>' +
        '<div class="stat-card"><div class="label">Доходы в месяц</div><div class="value" style="color:#3ddc97">' + money(f.avgIncome) + '</div>' +
          '<div class="hint">в среднем</div></div>' +
        '<div class="stat-card"><div class="label">Расходы в месяц</div><div class="value" style="color:#ff9a9a">' + money(f.avgExpense) + '</div>' +
          '<div class="hint">в среднем</div></div>' +
      '</div>' +
      '<div class="info-card"><h3>Как считается</h3>' +
        '<p>Берём текущий итог по всем операциям и прибавляем средний дневной доход, вычитая средний дневной расход. Разовые крупные покупки прогноз не предугадывает — это ориентир, а не гарантия.</p>' +
      '</div>'
    : '';

  el.innerHTML =
    '<div class="goal-head"><div><h1>Прогноз</h1><p>Сколько денег будет на выбранную дату</p></div></div>' +
    '<section class="forecast-card fc-view">' +
      '<div class="fc-top">' +
        '<div><div class="fc-kicker">ОЖИДАЕМЫЙ ОСТАТОК</div><div class="fc-h">На выбранную дату</div></div>' +
        '<input class="fc-date" type="date" id="forecastDateView" value="' + ui.forecastDate + '" min="' + today + '">' +
      '</div>' +
      body +
    '</section>' +
    '<div class="quick-periods">' + quickHTML + '</div>' +
    statsHTML;
}

function forecastChartSVG(f) {
  if (!f.hasData) return '';
  const W = 320;
  const H = 110;
  const padX = 10;
  const padY = 15;
  const days = Math.max(f.days, 1);
  const start = f.current;
  const end = f.projected;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const span = (hi - lo) || Math.max(Math.abs(start), 1);
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;
  const steps = Math.max(2, Math.min(24, Math.ceil(days / 7) + 1));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const v = start + (end - start) * (i / steps);
    const x = padX + plotW * (i / steps);
    const y = padY + plotH - ((v - lo) / span) * plotH;
    pts.push([x, y]);
  }
  const line = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
  const area = 'M' + padX + ',' + (H - padY) + ' L' + line.replace(/ /g, ' L') + ' L' + (W - padX) + ',' + (H - padY) + ' Z';
  const color = end >= start ? '#3ddc97' : '#ff6b6b';
  const last = pts[pts.length - 1];

  return '<div class="fc-chart-wrap">' +
    '<svg class="fc-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="fcGrad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + color + '" stop-opacity=".28"></stop>' +
          '<stop offset="1" stop-color="' + color + '" stop-opacity="0"></stop>' +
        '</linearGradient>' +
      '</defs>' +
      '<path d="' + area + '" fill="url(#fcGrad)"></path>' +
      '<polyline points="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.2" ' +
        'stroke-linejoin="round" stroke-linecap="round"></polyline>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.4" fill="' + color + '"></circle>' +
    '</svg>' +
    '<div class="fc-chart-labels"><span>сегодня</span><span>' + fullDateLabel(iso(f.target.getFullYear(), f.target.getMonth(), f.target.getDate())) + '</span></div>' +
  '</div>';
}

function donutSVG(cats, total, label) {
  const size = 240;
  const th = 26;
  const r = (size - th) / 2 - 6;
  const cx = size / 2;
  const C = 2 * Math.PI * r;
  let segments = '';

  if (total > 0 && cats.length) {
    let acc = 0;
    const gap = cats.length > 1 ? 5 : 0;
    cats.forEach(function (c, i) {
      const frac = c.amount / total;
      const len = frac * C;
      const draw = Math.max(len - gap, 1);
      segments += '<circle class="seg" cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" ' +
        'stroke="' + c.cat.color + '" stroke-width="' + th + '" stroke-linecap="butt" ' +
        'stroke-dasharray="' + draw.toFixed(2) + ' ' + (C - draw).toFixed(2) + '" ' +
        'stroke-dashoffset="' + (-acc).toFixed(2) + '" ' +
        'style="animation-delay:' + (i * 55) + 'ms"></circle>';
      acc += len;
    });
  }

  return '<svg class="donut" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + esc(label || 'Расходы по категориям') + '">' +
    '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="' + th + '"></circle>' +
    '<g transform="rotate(-90 ' + cx + ' ' + cx + ')">' + segments + '</g>' +
    '</svg>';
}

function renderHistory() {
  let list = state.transactions.slice();
  if (ui.chartType === 'income') list = list.filter(function (t) { return t.type === 'income'; });
  if (ui.chartType === 'expense') list = list.filter(function (t) { return t.type === 'expense'; });

  list.sort(function (a, b) {
    return b.date.localeCompare(a.date) || numId(b) - numId(a);
  });

  if (!list.length) {
    return '<div class="empty-card"><span class="big-emoji">🗂</span>' +
      (state.transactions.length ? 'По этому фильтру ничего нет.' : 'Пока нет операций. Нажмите «+», чтобы добавить первую.') +
      '</div>';
  }

  const groups = {};
  const order = [];
  list.forEach(function (t) {
    const k = monthKey(t.date);
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(t);
  });
  order.sort(function (a, b) { return b.localeCompare(a); });

  return order.map(function (k) {
    const items = groups[k];
    const rows = items.map(txRowHTML).join('');
    let label;
    let cls;
    if (ui.chartType === 'income') {
      const sum = items.reduce(function (s, t) { return s + t.amount; }, 0);
      label = '+' + money(sum);
      cls = 'pos';
    } else if (ui.chartType === 'expense') {
      const sum = items.reduce(function (s, t) { return s + t.amount; }, 0);
      label = '−' + money(sum);
      cls = 'neg';
    } else {
      const st = monthStats(k);
      label = money(st.balance, { sign: true });
      cls = st.balance >= 0 ? 'pos' : 'neg';
    }
    return '<div class="hist-month">' +
      '<div class="hm-head"><span class="hm-name">' + monthLabel(k) + '</span>' +
      '<span class="hm-net ' + cls + '">' + label + '</span></div>' +
      '<div class="tx-list">' + rows + '</div>' +
      '</div>';
  }).join('') + '<div class="hist-end">' +
    (ui.chartType === 'income' ? 'Это все доходы' : ui.chartType === 'expense' ? 'Это все расходы' : 'Это вся история операций') +
    '</div>';
}

function txRowHTML(t) {
  const cat = CAT[t.category] || { name: 'Другое', color: '#94a3b8', emoji: '✨' };
  const isIncome = t.type === 'income';
  const waste = isIncome ? 0 : Math.min(t.waste || 0, t.amount);
  return '<button class="tx-row" type="button" data-tx="' + t.id + '">' +
    '<span class="tx-icon" style="color:' + cat.color + '"><span>' + cat.emoji + '</span></span>' +
    '<span class="tx-main">' +
      '<span class="tx-title">' + esc(t.note || cat.name) + '</span>' +
      '<span class="tx-meta">' +
        '<span class="tx-cat">' + (isIncome ? 'Доход' : esc(cat.name)) + ' · ' + dateLabel(t.date) + '</span>' +
        (waste > 0 ? '<span class="waste-tag">утечки ' + money(waste) + '</span>' : '') +
      '</span>' +
    '</span>' +
    '<span class="tx-amount ' + (isIncome ? 'in' : 'out') + '">' +
      (isIncome ? '+' : '−') + money(t.amount) +
    '</span>' +
  '</button>';
}

/* ============================================================
   Экран цели
   ============================================================ */

function savingsJarSVG() {
  const jarPath = 'M56 70 Q56 58 68 58 H152 Q164 58 164 70 V138 Q164 154 148 154 H72 Q56 154 56 138 Z';
  return '<svg viewBox="0 0 220 180" class="savings-svg" aria-hidden="true">' +
    '<defs>' +
      '<linearGradient id="jarGlass" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#9ff8d2" stop-opacity=".34"></stop>' +
        '<stop offset="1" stop-color="#12a874" stop-opacity=".2"></stop>' +
      '</linearGradient>' +
      '<linearGradient id="jarLidGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#6df7c1"></stop><stop offset="1" stop-color="#17b979"></stop>' +
      '</linearGradient>' +
      '<linearGradient id="jarCoin" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#ffe08a"></stop><stop offset="1" stop-color="#f6b73c"></stop>' +
      '</linearGradient>' +
      '<filter id="jarShadow" x="-25%" y="-25%" width="150%" height="150%">' +
        '<feDropShadow dx="0" dy="9" stdDeviation="10" flood-color="#12a874" flood-opacity=".3"></feDropShadow>' +
      '</filter>' +
      '<clipPath id="jarClip"><path d="' + jarPath + '"></path></clipPath>' +
    '</defs>' +
    '<g filter="url(#jarShadow)">' +
      '<ellipse cx="110" cy="160" rx="56" ry="8" fill="#000" opacity=".16"></ellipse>' +
      '<path d="M110 31 v8" stroke="#3ddc97" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="2 4" opacity=".7"></path>' +
      '<g>' +
        '<ellipse cx="110" cy="22" rx="13" ry="5" fill="#f6b73c"></ellipse>' +
        '<rect x="97" y="17" width="26" height="6" rx="3" fill="#f6b73c"></rect>' +
        '<ellipse cx="110" cy="17" rx="13" ry="5" fill="url(#jarCoin)"></ellipse>' +
      '</g>' +
      '<path d="' + jarPath + '" fill="#3ddc97" fill-opacity=".05" stroke="#6df7c1" stroke-opacity=".5" stroke-width="2.5"></path>' +
      '<g clip-path="url(#jarClip)">' +
        '<ellipse cx="78" cy="143" rx="17" ry="6" fill="#b97f18"></ellipse>' +
        '<ellipse cx="78" cy="139" rx="17" ry="6" fill="url(#jarCoin)"></ellipse>' +
        '<ellipse cx="110" cy="147" rx="18" ry="6.5" fill="#b97f18"></ellipse>' +
        '<ellipse cx="110" cy="143" rx="18" ry="6.5" fill="url(#jarCoin)"></ellipse>' +
        '<ellipse cx="142" cy="144" rx="15" ry="5.5" fill="#b97f18"></ellipse>' +
        '<ellipse cx="142" cy="140" rx="15" ry="5.5" fill="url(#jarCoin)"></ellipse>' +
        '<ellipse cx="126" cy="131" rx="14" ry="5.5" fill="#b97f18"></ellipse>' +
        '<ellipse cx="126" cy="127" rx="14" ry="5.5" fill="url(#jarCoin)"></ellipse>' +
      '</g>' +
      '<path d="' + jarPath + '" fill="url(#jarGlass)"></path>' +
      '<path d="M70 76 Q64 101 70 128" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="6" stroke-linecap="round"></path>' +
      '<path d="M150 80 Q154 96 151 114" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="4" stroke-linecap="round"></path>' +
      '<rect x="62" y="42" width="96" height="18" rx="9" fill="url(#jarLidGrad)"></rect>' +
      '<rect x="70" y="45" width="80" height="4" rx="2" fill="#fff" fill-opacity=".28"></rect>' +
      '<rect x="90" y="47.5" width="40" height="6" rx="3" fill="#09231a"></rect>' +
      '<rect x="93" y="49" width="34" height="3" rx="1.5" fill="#1d5a44"></rect>' +
    '</g>' +
  '</svg>';
}

function renderGoal() {
  const view = $('#view-goal');
  const gs = goalStats();

  if (!gs) {
    view.innerHTML =
      '<div class="goal-head"><div><h1>Цели</h1><p>Накопления без таблиц и Excel</p></div></div>' +
      '<div class="goal-empty">' +
        '<div class="savings-big">' + savingsJarSVG() + '</div>' +
        '<h2>Заведите копилку</h2>' +
        '<p>Укажите, сколько хотите накопить и к какой дате. Каждый закрытый месяц остаток дохода будет пополнять цель, а минус — уменьшать её.</p>' +
        '<button class="btn primary" type="button" data-set-goal>Поставить цель</button>' +
      '</div>';
    return;
  }

  const pctClamped = clamp(gs.pct, 0, 1);
  const C = 2 * Math.PI * 122;
  const low = gs.saved < 0;
  const pctLabel = Math.round(gs.pct * 100);
  const curKey = currentKey();
  const pendingMonthName = MONTHS_GEN[Number(curKey.split('-')[1]) - 1];

  const accrualRows = gs.accruals.slice().reverse().slice(0, 8).map(function (a) {
    return '<div class="accrual-row"><span class="m">' + monthLabel(a.key) + '</span>' +
      '<span class="v ' + (a.value >= 0 ? 'pos' : 'neg') + '">' + money(a.value, { sign: true }) + '</span></div>';
  }).join('');

  let pendingText = '';
  if (gs.pending !== 0) {
    pendingText = '<div class="goal-pending ' + (gs.pending >= 0 ? 'pos' : 'neg') + '">' +
      (gs.pending >= 0 ? '↑' : '↓') +
      ' В конце ' + pendingMonthName + ': ' + money(gs.pending, { sign: true }) +
      '</div>';
  }

  const deadlineText = gs.daysLeft >= 0
    ? 'осталось ' + gs.daysLeft + ' ' + daysWord(gs.daysLeft)
    : 'срок истёк';
  const goalTitle = (state.goal.title || 'Моя цель');

  view.innerHTML =
    '<div class="goal-head">' +
      '<div><h1>' + esc(goalTitle) + '</h1><p>' + (gs.done ? 'Цель достигнута — можно гордиться' : 'Ваш путь к накоплениям') + '</p></div>' +
      '<button class="icon-btn" type="button" data-edit-goal aria-label="Изменить цель">✎</button>' +
    '</div>' +

    '<div class="goal-visual' + (low ? ' low' : '') + '">' +
      '<svg class="goal-ring" viewBox="0 0 280 280" role="img" aria-label="Прогресс цели ' + pctLabel + '%">' +
        '<defs>' +
          '<linearGradient id="goalGrad" x1="0" y1="0" x2="1" y2="1">' +
            (low
              ? '<stop offset="0" stop-color="#ff9d76"></stop><stop offset="1" stop-color="#ff5f6d"></stop>'
              : '<stop offset="0" stop-color="#6df7c1"></stop><stop offset="1" stop-color="#12a874"></stop>') +
          '</linearGradient>' +
        '</defs>' +
        '<circle class="track" cx="140" cy="140" r="122" fill="none" stroke-width="14"></circle>' +
        '<circle class="progress" cx="140" cy="140" r="122" fill="none" stroke-width="14" ' +
          'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pctClamped)).toFixed(1) + '" ' +
          'transform="rotate(-90 140 140)"></circle>' +
      '</svg>' +
      '<div class="savings-jar">' + savingsJarSVG() + '</div>' +
      '<div class="goal-pct' + (low ? ' low' : '') + '">' + pctLabel + '%</div>' +
    '</div>' +

    '<div class="goal-hero">' +
      '<div class="saved" style="color:' + (low ? '#ff6b6b' : gs.done ? '#3ddc97' : '#eef4fb') + '">' + money(gs.saved) + '</div>' +
      '<div class="of">из <b>' + money(gs.target) + '</b> · ' + (gs.done ? 'цель закрыта 🎉' : 'осталось ' + money(gs.remaining)) + '</div>' +
      pendingText +
    '</div>' +

    '<div class="stat-grid">' +
      '<div class="stat-card"><div class="label">Срок</div><div class="value">' + fullDateLabel(state.goal.endDate) + '</div>' +
        '<div class="hint">' + deadlineText + '</div></div>' +
      '<div class="stat-card"><div class="label">Нужно в месяц</div><div class="value">' + money(gs.perMonth) + '</div>' +
        '<div class="hint">с учётом накопленного</div></div>' +
    '</div>' +

    '<div class="info-card">' +
      '<h3>Пополнения по месяцам</h3>' +
      (accrualRows
        ? '<div class="accrual-list">' + accrualRows + '</div>'
        : '<p>Первый месяц ещё не закрыт. Пополнение появится после его окончания.</p>') +
    '</div>' +

    '<div class="info-card">' +
      '<h3>Как это работает</h3>' +
      '<p>Остаток каждого закрытого месяца (доходы минус расходы) автоматически идёт в копилку. Если месяц закрылся в минус — цель уменьшается на эту сумму. Текущий месяц ещё в процессе.</p>' +
    '</div>';
}

/* ============================================================
   Экран утечек
   ============================================================ */

function renderWaste() {
  const view = $('#view-waste');
  const ws = wasteStats();
  const phrase = WASTE_PHRASES[Math.floor(ws.total) % WASTE_PHRASES.length];

  if (!ws.entries.length) {
    view.innerHTML =
      '<div class="goal-head"><div><h1>Утечки</h1><p>Траты зря и деньги, которые ушли не туда</p></div></div>' +
      '<div class="waste-empty"><span class="e">🧘</span>' +
        'Пока чисто. Откройте любую трату в истории и отметьте, сколько из неё ушло на вредные привычки или покупки, без которых можно было обойтись.' +
      '</div>';
    return;
  }

  const share = ws.totalExpense > 0 ? (ws.total / ws.totalExpense * 100) : 0;
  const custom = customSavings(ws);
  const entriesHTML = ws.entries.map(function (t) {
    const cat = CAT[t.category] || { name: 'Другое' };
    const waste = Math.min(t.waste || 0, t.amount);
    return '<button class="waste-item" type="button" data-tx="' + t.id + '">' +
      '<span><div class="wt">' + esc(t.note || cat.name) + '</div>' +
      '<div class="wd">' + dateLabel(t.date) + ' · из ' + money(t.amount) + '</div></span>' +
      '<span class="wa">−' + money(waste) + '<small>утечки</small></span>' +
      '</button>';
  }).join('');

  view.innerHTML =
    '<div class="goal-head"><div><h1>Утечки</h1><p>Траты зря и деньги, которые ушли не туда</p></div></div>' +

    '<section class="waste-hero">' +
      '<div class="waste-kicker">⚠ Испарилось без следа</div>' +
      '<div class="waste-total">' + money(ws.total) + '</div>' +
      '<div class="waste-sub">' + esc(phrase) + ' Это <b>' + (share < 1 ? 'меньше 1' : Math.round(share)) + '%</b> всех ваших расходов.</div>' +
      '<div class="pct-line"><span>доля утечек</span><div class="mini-bar"><span style="width:' + clamp(share, 2, 100).toFixed(1) + '%"></span></div></div>' +
    '</section>' +

    '<div class="waste-grid">' +
      '<div class="waste-card"><div class="label">За неделю</div><div class="value">' + money(ws.week) + '</div><div class="note">в среднем</div></div>' +
      '<div class="waste-card"><div class="label">За месяц</div><div class="value">' + money(ws.month) + '</div><div class="note">в среднем</div></div>' +
      '<div class="waste-card"><div class="label">За год</div><div class="value">' + money(ws.year) + '</div><div class="note">если ничего не менять</div></div>' +
      '<div class="waste-card all"><div class="label">Всего отмечено</div><div class="value">' + money(ws.total) + '</div><div class="note">' + ws.entries.length + ' ' + plural(ws.entries.length, ['операция', 'операции', 'операций']) + '</div></div>' +
    '</div>' +

    '<div class="calc-card">' +
      '<h3>А если продержаться?</h3>' +
      '<p class="hint">Столько вы могли бы сохранить, не тратя впустую ещё столько же времени.</p>' +
      '<div class="calc-row">' +
        '<input id="customAmount" type="number" min="1" step="1" value="' + ui.customAmount + '" aria-label="Период">' +
        '<select id="customUnit" aria-label="Единица периода">' +
          '<option value="days"' + (ui.customUnit === 'days' ? ' selected' : '') + '>дней</option>' +
          '<option value="weeks"' + (ui.customUnit === 'weeks' ? ' selected' : '') + '>недель</option>' +
          '<option value="months"' + (ui.customUnit === 'months' ? ' selected' : '') + '>месяцев</option>' +
        '</select>' +
      '</div>' +
      '<div class="calc-result"><span class="lbl">Можно было бы сэкономить</span>' +
        '<span class="num" id="customResult">' + money(custom) + '</span></div>' +
    '</div>' +

    '<div class="section-head"><div><h2>Что именно</h2><p class="section-sub">Нажмите, чтобы изменить оценку</p></div>' +
      '<span class="hm-net neg">' + ws.entries.length + ' шт.</span></div>' +
    '<div class="waste-list">' + entriesHTML + '</div>';
}

function customSavings(ws) {
  const unitDays = ui.customUnit === 'weeks' ? 7 : ui.customUnit === 'months' ? 30.44 : 1;
  const days = Math.max(1, Number(ui.customAmount) || 0) * unitDays;
  return ws.daily * days;
}

/* ============================================================
   Модальные окна
   ============================================================ */

function openSheet(html) {
  const root = $('#modalRoot');
  root.innerHTML = '<div class="sheet-backdrop">' +
    '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div></div>';
  root.style.pointerEvents = 'auto';
  document.body.style.overflow = 'hidden';
  const backdrop = root.firstElementChild;
  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) closeSheet();
  });
}

function closeSheet() {
  const root = $('#modalRoot');
  root.innerHTML = '';
  root.style.pointerEvents = 'none';
  document.body.style.overflow = '';
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
}

/* ---------- добавление операции ---------- */

const addDraft = { type: 'expense', category: 'food' };

function catGridHTML(type, active) {
  const list = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  return list.map(function (c) {
    return '<button type="button" class="cat-chip' + (c.id === active ? ' is-active' : '') + '" ' +
      'data-cat="' + c.id + '" style="--c:' + c.color + '">' +
      '<span class="emoji">' + c.emoji + '</span><span>' + c.name + '</span></button>';
  }).join('');
}

function openAddSheet() {
  addDraft.type = 'expense';
  addDraft.category = 'food';

  openSheet(
    '<div class="sheet-handle"></div>' +
    '<h2>Новая операция</h2>' +
    '<p class="sheet-sub">Запишите доход или расход — он сразу попадёт в статистику и историю.</p>' +
    '<div class="segmented" id="typeSeg">' +
      '<button type="button" data-type="expense" class="is-active">− Расход</button>' +
      '<button type="button" data-type="income">+ Доход</button>' +
    '</div>' +
    '<label class="field"><span>Сумма</span><div class="amount-field">' +
      '<input id="txAmount" type="text" inputmode="decimal" placeholder="0" autocomplete="off">' +
      '<span class="cur">' + esc(activeCurrency().symbol) + '</span></div></label>' +
    '<div class="field"><span>Категория</span><div class="cat-grid" id="catGrid">' + catGridHTML('expense', 'food') + '</div></div>' +
    '<label class="field"><span>Дата</span>' +
      '<input id="txDate" type="date" value="' + todayISO() + '" max="' + todayISO() + '"></label>' +
    '<label class="field"><span>Комментарий</span>' +
      '<input id="txNote" type="text" maxlength="70" placeholder="Необязательно" autocomplete="off"></label>' +
    '<button class="btn primary" type="button" id="txSave">Добавить</button>'
  );

  const seg = $('#typeSeg');
  const grid = $('#catGrid');

  seg.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-type]');
    if (!btn) return;
    addDraft.type = btn.dataset.type;
    addDraft.category = addDraft.type === 'income' ? INCOME_CATS[0].id : EXPENSE_CATS[0].id;
    seg.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.type === addDraft.type);
    });
    grid.innerHTML = catGridHTML(addDraft.type, addDraft.category);
  });

  grid.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    addDraft.category = btn.dataset.cat;
    grid.querySelectorAll('.cat-chip').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.cat === addDraft.category);
    });
  });

  setTimeout(function () { const el = $('#txAmount'); if (el) el.focus(); }, 120);

  $('#txSave').addEventListener('click', function () {
    const amount = rubFromInput($('#txAmount').value);
    if (amount <= 0) {
      toast('Введите сумму больше нуля');
      $('#txAmount').focus();
      return;
    }
    const date = $('#txDate').value || todayISO();
    state.transactions.push({
      id: uid(),
      type: addDraft.type,
      category: addDraft.category,
      amount: amount,
      date: date,
      note: $('#txNote').value.trim().slice(0, 70),
      waste: 0,
    });
    persist();
    closeSheet();
    ui.month = monthKey(date);
    refresh();
    switchTab('home');
    toast(addDraft.type === 'income' ? 'Доход добавлен' : 'Расход добавлен');
  });
}

/* ---------- детали операции ---------- */

function openTxSheet(id) {
  const t = state.transactions.find(function (x) { return x.id === id; });
  if (!t) return;
  const cat = CAT[t.category] || { name: 'Другое', color: '#94a3b8', emoji: '✨' };
  const isExpense = t.type === 'expense';
  const waste = Math.min(t.waste || 0, t.amount);

  openSheet(
    '<div class="sheet-handle"></div>' +
    '<div class="detail-top">' +
      '<div class="detail-icon">' + cat.emoji + '</div>' +
      '<div><div class="detail-cat">' + esc(cat.name) + ' · ' + (isExpense ? 'расход' : 'доход') + '</div>' +
      '<div class="detail-date">' + fullDateLabel(t.date) + '</div></div>' +
    '</div>' +
    '<div class="detail-amount ' + (isExpense ? 'out' : 'in') + '">' +
      (isExpense ? '−' : '+') + money(t.amount) + '</div>' +
    (t.note ? '<p class="detail-note">' + esc(t.note) + '</p>' : '') +

    (isExpense
      ? '<div class="divider"></div>' +
        '<div class="waste-box">' +
          '<h3>Сколько из этого — утечки?</h3>' +
          '<p>Вредные привычки, импульсивные покупки, «ну ладно, один раз». Эта сумма попадёт во вкладку «Утечки».</p>' +
          '<div class="waste-input"><input id="wasteAmount" type="text" inputmode="decimal" placeholder="0" value="' + (waste ? inputAmount(waste) : '') + '">' +
          '<span class="cur">' + esc(activeCurrency().symbol) + '</span></div>' +
          '<div class="quick-chips">' +
            '<button type="button" data-pct="0.1">10%</button>' +
            '<button type="button" data-pct="0.25">25%</button>' +
            '<button type="button" data-pct="0.5">50%</button>' +
            '<button type="button" data-pct="1">Вся сумма</button>' +
          '</div>' +
          (waste > 0
            ? '<div class="waste-existing"><span>Уже отмечено: ' + money(waste) + '</span>' +
              '<button type="button" id="wasteClear">сбросить</button></div>'
            : '') +
          '<button class="btn primary" type="button" id="wasteSave">Сохранить отметку</button>' +
        '</div>'
      : '<div class="divider"></div>' +
        '<p class="detail-note" style="color:var(--muted);font-size:12px">Доходы нельзя отметить как пустую трату — это же хорошая новость.</p>') +

    '<div class="btn-row">' +
      '<button class="btn ghost danger" type="button" id="txDelete">Удалить операцию</button>' +
      '<button class="btn ghost" type="button" data-close>Закрыть</button>' +
    '</div>'
  );

  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', closeSheet);
  });

  if (isExpense) {
    const input = $('#wasteAmount');
    const quick = document.querySelector('.quick-chips');
    quick.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-pct]');
      if (!btn) return;
      input.value = inputAmount(t.amount * Number(btn.dataset.pct));
      input.focus();
    });

    const clear = $('#wasteClear');
    if (clear) {
      clear.addEventListener('click', function () {
        t.waste = 0;
        persist();
        closeSheet();
        refresh();
        toast('Отметка снята');
      });
    }

    $('#wasteSave').addEventListener('click', function () {
      let v = rubFromInput(input.value);
      if (v < 0) v = 0;
      if (v > t.amount) v = t.amount;
      t.waste = v;
      persist();
      closeSheet();
      refresh();
      toast(v > 0 ? 'Отмечено утечек: ' + money(v) : 'Отметка снята');
    });
  }

  $('#txDelete').addEventListener('click', function () {
    if (!window.confirm('Удалить эту операцию? Это действие нельзя отменить.')) return;
    state.transactions = state.transactions.filter(function (x) { return x.id !== t.id; });
    persist();
    closeSheet();
    refresh();
    toast('Операция удалена');
  });
}

/* ---------- цель ---------- */

function openGoalSheet() {
  const g = state.goal;
  const target = g ? g.target : 150000;
  const endDate = g ? g.endDate : addMonthsDateStr(new Date(), 6);
  const initial = g ? g.initial : 0;
  const goalTitle = g && g.title ? g.title : '';
  const minDate = addMonthsDateStr(new Date(), 1);

  openSheet(
    '<div class="sheet-handle"></div>' +
    '<h2>' + (g ? 'Изменить цель' : 'Новая финансовая цель') + '</h2>' +
    '<p class="sheet-sub">Каждый закрытый месяц остаток доходов автоматически пополняет копилку. Минус — уменьшает.</p>' +
    '<label class="field"><span>Название цели</span>' +
      '<input id="goalTitle" type="text" maxlength="40" value="' + esc(goalTitle) + '" placeholder="Например, на отпуск" autocomplete="off"></label>' +
    '<label class="field"><span>Сколько хотите накопить</span>' +
      '<div class="amount-field"><input id="goalTarget" type="text" inputmode="decimal" value="' + inputAmount(target) + '">' +
      '<span class="cur">' + esc(activeCurrency().symbol) + '</span></div></label>' +
    '<label class="field"><span>Конечная дата</span>' +
      '<input id="goalDate" type="date" value="' + endDate + '" min="' + minDate + '"></label>' +
    '<label class="field"><span>Уже накоплено (необязательно, ' + esc(activeCurrency().symbol) + ')</span>' +
      '<input id="goalInitial" type="text" inputmode="decimal" value="' + inputAmount(initial) + '" placeholder="0"></label>' +
    '<button class="btn primary" type="button" id="goalSave">' + (g ? 'Сохранить' : 'Создать цель') + '</button>'
  );

  $('#goalSave').addEventListener('click', function () {
    const titleValue = $('#goalTitle').value.trim() || 'Моя цель';
    const targetValue = rubFromInput($('#goalTarget').value);
    const dateValue = $('#goalDate').value;
    const initialValue = Math.max(0, rubFromInput($('#goalInitial').value));
    if (targetValue <= 0) { toast('Укажите сумму цели'); return; }
    if (!dateValue) { toast('Выберите конечную дату'); return; }

    if (state.goal) {
      state.goal.title = titleValue;
      state.goal.target = targetValue;
      state.goal.endDate = dateValue;
      state.goal.initial = initialValue;
    } else {
      state.goal = {
        title: titleValue,
        target: targetValue,
        endDate: dateValue,
        initial: initialValue,
        startMonth: currentKey(),
        createdAt: new Date().toISOString(),
      };
    }
    persist();
    closeSheet();
    refresh();
    switchTab('goal');
    toast(g ? 'Цель обновлена' : 'Цель создана');
  });
}

/* ---------- аккаунт, облако и потоки ---------- */

const USER_ICON = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">' +
  '<circle cx="12" cy="8.4" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"></circle>' +
  '<path d="M5.4 20c.5-3.4 3.1-5.4 6.6-5.4s6.1 2 6.6 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>' +
  '</svg>';

let authMode = 'login';
let authLoading = false;

function accountInitial(v) {
  const s = String(v || '').trim();
  return s ? s.charAt(0).toUpperCase() : '?';
}

function renderAccountBtn() {
  const btn = $('#accountBtn');
  if (!btn) return;
  if (account) {
    btn.classList.add('is-auth');
    btn.innerHTML = '<span class="account-initial">' + esc(accountInitial(account.name || account.email)) + '</span>';
    btn.setAttribute('aria-label', 'Профиль: ' + account.email);
  } else {
    btn.classList.remove('is-auth');
    btn.innerHTML = USER_ICON;
    btn.setAttribute('aria-label', 'Профиль');
  }
}

function renderStreamName() {
  const nameEl = $('#streamName');
  const btn = $('#streamBtn');
  if (!nameEl || !btn) return;
  nameEl.textContent = activeStream ? activeStream.name : 'Мой поток';
  btn.classList.toggle('is-guest', !account);
  btn.setAttribute('aria-label', activeStream ? 'Поток: ' + activeStream.name : 'Выбрать поток');
}

function authErrorText(err) {
  const msg = String((err && (err.message || err.error_description || err.msg)) || '');
  if (/Invalid login credentials/i.test(msg)) return 'Неверная почта или пароль.';
  if (/Email not confirmed/i.test(msg)) return 'Сначала подтвердите почту — проверьте письмо.';
  if (/User already registered/i.test(msg)) return 'Такая почта уже зарегистрирована. Перейдите на вкладку «Войти».';
  if (/Password should be/i.test(msg)) return 'Пароль должен быть не короче 6 символов.';
  if (/rate limit|too many/i.test(msg)) return 'Слишком много попыток. Подождите минуту.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Нет связи с сервером. Проверьте интернет.';
  if (/invite_not_found/i.test(msg)) return 'Приглашение не найдено или истекло.';
  return msg || 'Не получилось. Попробуйте ещё раз.';
}

function openRegisterSheet() {
  openAuthSheet('signup');
}

function openAuthSheet(mode) {
  if (!sb) { toast('Облако не настроено'); return; }
  authMode = mode === 'signup' ? 'signup' : 'login';
  const isSignup = authMode === 'signup';

  openSheet(
    '<div class="sheet-handle"></div>' +
    '<h2>' + (isSignup ? 'Создать аккаунт' : 'Вход по почте') + '</h2>' +
    '<p class="sheet-sub">' + (isSignup
      ? 'Аккаунт нужен, чтобы данные сохранялись и были доступны на других устройствах.'
      : 'Войдите, чтобы вернуться к своим потокам и операциям.') + '</p>' +
    '<div class="auth-tabs">' +
      '<button class="auth-tab' + (!isSignup ? ' is-active' : '') + '" type="button" data-auth-mode="login">Войти</button>' +
      '<button class="auth-tab' + (isSignup ? ' is-active' : '') + '" type="button" data-auth-mode="signup">Регистрация</button>' +
    '</div>' +
    (inviteRef
      ? '<div class="ref-chip"><span>Приглашение в поток</span><b>' + esc(inviteRef) + '</b></div>'
      : '') +
    (isSignup
      ? '<label class="field"><span>Как вас зовут</span>' +
        '<input id="authName" type="text" maxlength="40" placeholder="Имя" autocomplete="name"></label>'
      : '') +
    '<label class="field"><span>Email</span>' +
      '<input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email"></label>' +
    '<label class="field"><span>Пароль</span>' +
      '<input id="authPassword" type="password" minlength="6" placeholder="Минимум 6 символов" autocomplete="' + (isSignup ? 'new-password' : 'current-password') + '"></label>' +
    '<div class="auth-error" id="authError"></div>' +
    '<button class="btn primary" type="button" id="authSubmit">' + (isSignup ? 'Создать аккаунт' : 'Войти') + '</button>' +
    '<p class="auth-note">' + (isSignup
      ? 'После регистрации может потребоваться подтвердить почту. Пароль хранится в Supabase в защищённом виде.'
      : 'Пароль не хранится в приложении. Сессия сохраняется в этом браузере.') + '</p>'
  );

  setTimeout(function () {
    const el = $(isSignup ? '#authName' : '#authEmail');
    if (el) el.focus();
  }, 120);

  document.querySelectorAll('[data-auth-mode]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      openAuthSheet(tab.dataset.authMode);
    });
  });

  $('#authSubmit').addEventListener('click', submitAuth);
  $('#authPassword').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitAuth();
  });
}

async function submitAuth() {
  if (!sb) return;
  const isSignup = authMode === 'signup';
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  const name = isSignup ? $('#authName').value.trim() : '';
  const errEl = $('#authError');
  const btn = $('#authSubmit');

  errEl.textContent = '';
  if (isSignup && !name) { errEl.textContent = 'Введите имя.'; $('#authName').focus(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { errEl.textContent = 'Проверьте адрес почты.'; $('#authEmail').focus(); return; }
  if (password.length < 6) { errEl.textContent = 'Пароль должен быть не короче 6 символов.'; $('#authPassword').focus(); return; }

  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = isSignup ? 'Создаю…' : 'Вхожу…';

  try {
    if (isSignup) {
      const { data, error } = await sb.auth.signUp({
        email: email,
        password: password,
        options: { data: { name: name } },
      });
      if (error) throw error;
      if (data && data.session && data.user) {
        await handleSignedIn(data.user);
        closeSheet();
        toast('Аккаунт создан');
      } else {
        errEl.textContent = 'Аккаунт создан. Подтвердите почту по ссылке из письма, затем войдите.';
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email: email, password: password });
      if (error) throw error;
      if (data && data.user) {
        await handleSignedIn(data.user);
        closeSheet();
        toast('Вы вошли');
      }
    }
  } catch (e) {
    errEl.textContent = authErrorText(e);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function openAccountSheet() {
  if (!account) { openAuthSheet('login'); return; }
  const since = account.createdAt ? fullDateLabel(String(account.createdAt).slice(0, 10)) : '';

  openSheet(
    '<div class="sheet-handle"></div>' +
    '<div class="auth-head">' +
      '<div class="auth-avatar">' + esc(accountInitial(account.name || account.email)) + '</div>' +
      '<h2>' + esc(account.name) + '</h2>' +
      '<p>' + esc(account.email) + (since ? ' · с нами с ' + since : '') + '</p>' +
    '</div>' +
    (activeStream
      ? '<div class="ref-chip"><span>Текущий поток</span><b>' + esc(activeStream.name) + '</b></div>'
      : '') +
    '<button class="btn primary" type="button" id="accountInvite" style="margin-bottom:9px">Пригласить друга</button>' +
    '<button class="btn ghost" type="button" id="accountStreams" style="margin-bottom:9px">Мои потоки</button>' +
    '<button class="btn ghost danger" type="button" id="accountLogout">Выйти из аккаунта</button>' +
    '<p class="auth-note">Данные синхронизируются с облаком. <span id="syncBadge" class="sync-badge">В облаке</span></p>'
  );

  $('#accountInvite').addEventListener('click', openInviteSheet);
  $('#accountStreams').addEventListener('click', openStreamsSheet);
  $('#accountLogout').addEventListener('click', async function () {
    if (!sb) return;
    await flushCloudSave();
    await sb.auth.signOut();
    handleSignedOut();
    closeSheet();
    toast('Вы вышли из аккаунта');
  });
}

function inviteQrSvg(link) {
  if (typeof window.qrcode !== 'function') return '';
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    return qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
  } catch (e) {
    console.warn('Potok QR:', e);
    return '';
  }
}

async function openInviteSheet() {
  if (!account) { openAuthSheet('login'); return; }
  if (!activeStream) await createCloudStream('Мой поток');
  if (!activeStream || !sb) { toast('Сначала создайте поток'); return; }

  let code = '';
  try {
    const { data, error } = await sb.rpc('create_stream_invite', { p_stream_id: activeStream.id });
    if (error) throw error;
    code = String(data || '').toUpperCase();
  } catch (e) {
    console.warn('Potok invite:', e);
    toast('Не удалось создать приглашение');
    return;
  }
  if (!code) { toast('Не удалось создать приглашение'); return; }

  const link = inviteLink(code);
  const qrSvg = inviteQrSvg(link);
  const subject = encodeURIComponent('Приглашаю тебя в поток «' + activeStream.name + '»');
  const body = encodeURIComponent('Привет! Присоединяйся к моему потоку «' + activeStream.name + '» в приложении «Поток»:\n\n' + link + '\n\nКод: ' + code);

  openSheet(
    '<div class="sheet-handle"></div>' +
    '<h2>Пригласить друга</h2>' +
    '<p class="sheet-sub">Ссылка приглашает именно в поток «' + esc(activeStream.name) + '». Другие ваши потоки другу не видны.</p>' +
    '<div class="invite-qr">' +
      '<div class="invite-qr-box" id="inviteQr">' +
        (qrSvg || '<span class="invite-qr-fallback">QR-код недоступен</span>') +
      '</div>' +
      '<p class="invite-qr-hint">Наведите камеру телефона — откроется приглашение в этот поток</p>' +
      '<button class="invite-qr-download" type="button" id="inviteQrDownload"' + (qrSvg ? '' : ' disabled') + '>Скачать QR</button>' +
    '</div>' +
    '<div class="invite-link">' +
      '<input id="inviteInput" readonly value="' + esc(link) + '">' +
      '<button type="button" id="copyInvite">Копировать</button>' +
    '</div>' +
    '<a class="btn primary" id="inviteEmail" href="mailto:?subject=' + subject + '&body=' + body + '" style="margin-bottom:9px">Отправить на почту</a>' +
    '<button class="btn ghost" type="button" id="inviteShare">Поделиться ссылкой</button>' +
    '<div class="ref-code">Код приглашения: <b>' + esc(code) + '</b></div>' +
    '<p class="auth-note">Код действует 90 дней. Друг сможет присоединиться после входа по почте.</p>'
  );

  $('#inviteQrDownload').addEventListener('click', function () {
    const box = $('#inviteQr');
    const svg = box ? box.querySelector('svg') : null;
    if (!svg) { toast('QR-код недоступен'); return; }

    if (!svg.getAttribute('xmlns')) {
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'potok-' + code + '.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('QR-код сохранён');
  });

  $('#copyInvite').addEventListener('click', function () {
    const input = $('#inviteInput');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () {
        toast('Ссылка скопирована');
      }).catch(function () {
        input.select();
        toast('Скопируйте ссылку вручную');
      });
    } else {
      input.select();
      toast('Скопируйте ссылку вручную');
    }
  });

  $('#inviteShare').addEventListener('click', function () {
    if (navigator.share) {
      navigator.share({ title: 'Поток', text: 'Присоединяйся к потоку «' + activeStream.name + '»', url: link }).catch(function () {});
    } else {
      const input = $('#inviteInput');
      input.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () { toast('Ссылка скопирована'); }).catch(function () { toast('Скопируйте ссылку вручную'); });
      } else {
        toast('Скопируйте ссылку вручную');
      }
    }
  });
}

async function loadStreams() {
  if (!sb || !authUser) { streams = []; return []; }
  const { data, error } = await sb.from('streams')
    .select('id,name,owner_id,created_at')
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('Potok streams:', error);
    streams = [];
    return [];
  }
  streams = data || [];
  return streams;
}

async function loadStream(id) {
  if (!sb || !authUser || !id) return;
  await flushCloudSave();

  let meta = streams.find(function (s) { return s.id === id; });
  if (!meta) {
    await loadStreams();
    meta = streams.find(function (s) { return s.id === id; });
  }
  if (!meta) meta = { id: id, name: 'Поток', owner_id: null };

  activeStream = meta;
  try {
    const { data, error } = await sb.from('stream_states')
      .select('state')
      .eq('stream_id', id)
      .maybeSingle();
    if (error) throw error;
    state = normalizeState(data && data.state);
  } catch (e) {
    console.warn('Potok load stream:', e);
    state = emptyState();
  }

  persistState(state);
  try { localStorage.setItem(ACTIVE_STREAM_KEY, id); } catch (e) { /* ignore */ }
  ui.month = currentKey();
  refresh();
  subscribeStream();
  renderStreamName();
}

async function switchStream(id) {
  if (!id) return;
  closeSheet();
  if (activeStream && activeStream.id === id) return;
  await loadStream(id);
  toast('Поток: ' + (activeStream ? activeStream.name : ''));
}

async function createCloudStream(name) {
  if (!sb || !authUser) { openAuthSheet('login'); return false; }
  const streamName = String(name || '').trim() || 'Мой поток';
  try {
    const { data, error } = await sb.rpc('create_stream', { p_name: streamName });
    if (error) throw error;
    await loadStreams();
    const meta = streams.find(function (s) { return s.id === data; }) ||
      { id: data, name: streamName, owner_id: authUser.id };
    await loadStream(meta.id);
    return true;
  } catch (e) {
    console.warn('Potok create stream:', e);
    toast('Не удалось создать поток');
    return false;
  }
}

async function joinInvite(code) {
  if (!code) return false;
  if (!sb || !authUser) {
    inviteRef = String(code).toUpperCase();
    openAuthSheet('login');
    return false;
  }
  try {
    const { data, error } = await sb.rpc('join_stream', { p_code: code });
    if (error) throw error;
    await loadStreams();
    const meta = streams.find(function (s) { return s.id === data; }) ||
      { id: data, name: 'Поток', owner_id: null };
    await loadStream(meta.id);
    try {
      const url = new URL(location.href);
      url.searchParams.delete('join');
      url.searchParams.delete('ref');
      history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
    } catch (e) { /* ignore */ }
    inviteRef = '';
    toast('Вы присоединились к потоку');
    return true;
  } catch (e) {
    console.warn('Potok join:', e);
    toast(authErrorText(e));
    return false;
  }
}

async function openStreamsSheet() {
  if (!account) { openAuthSheet('login'); return; }
  await loadStreams();
  const rows = streams.map(function (s) {
    const isActive = activeStream && activeStream.id === s.id;
    const isOwner = authUser && s.owner_id === authUser.id;
    return '<button class="stream-row' + (isActive ? ' is-active' : '') + '" type="button" data-stream="' + esc(s.id) + '">' +
      '<span class="stream-row-avatar">' + esc(accountInitial(s.name)) + '</span>' +
      '<span class="stream-row-info"><b>' + esc(s.name) + '</b><small>' + (isOwner ? 'владелец' : 'участник') + '</small></span>' +
      (isActive ? '<span class="stream-row-check">✓</span>' : '') +
    '</button>';
  }).join('');

  openSheet(
    '<div class="sheet-handle"></div>' +
    '<h2>Мои потоки</h2>' +
    '<p class="sheet-sub">У каждого потока свои операции и цель. Друзья видят только тот поток, в который их пригласили.</p>' +
    '<div class="stream-list">' + (rows || '<div class="stream-empty">Потоков пока нет. Создайте первый.</div>') + '</div>' +
    '<button class="btn primary" type="button" id="newStream">Создать поток</button>' +
    '<p class="auth-note">Новый поток сначала виден только вам.</p>'
  );

  document.querySelectorAll('[data-stream]').forEach(function (btn) {
    btn.addEventListener('click', function () { switchStream(btn.dataset.stream); });
  });
  $('#newStream').addEventListener('click', openCreateStreamSheet);
}

function openCreateStreamSheet() {
  openSheet(
    '<div class="sheet-handle"></div>' +
    '<h2>Новый поток</h2>' +
    '<p class="sheet-sub">Например: «Семья», «Бизнес» или «Путешествия». Начнётся с нуля.</p>' +
    '<label class="field"><span>Название</span>' +
      '<input id="newStreamName" type="text" maxlength="60" placeholder="Мой поток" autocomplete="off"></label>' +
    '<div class="auth-error" id="streamError"></div>' +
    '<button class="btn primary" type="button" id="createStreamBtn">Создать поток</button>' +
    '<p class="auth-note">Приглашённые в другие потоки люди не увидят этот поток.</p>'
  );

  setTimeout(function () { const el = $('#newStreamName'); if (el) el.focus(); }, 120);

  $('#createStreamBtn').addEventListener('click', async function () {
    const name = $('#newStreamName').value.trim();
    const err = $('#streamError');
    const btn = $('#createStreamBtn');
    if (!name) { err.textContent = 'Введите название.'; $('#newStreamName').focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Создаю…';
    const ok = await createCloudStream(name);
    btn.disabled = false;
    btn.textContent = 'Создать поток';
    if (ok) {
      closeSheet();
      toast('Поток создан');
    } else {
      err.textContent = 'Не удалось создать поток. Попробуйте ещё раз.';
    }
  });
}

async function handleSignedIn(user) {
  if (!user || !sb) return;
  if (authLoading) return;
  if (authUser && authUser.id === user.id && account && streams.length) return;

  authLoading = true;
  try {
    authUser = user;

    let prof = null;
    try {
      const { data } = await sb.from('profiles')
        .select('id,email,name,created_at')
        .eq('id', user.id)
        .maybeSingle();
      prof = data;
      if (!prof) {
        const fallbackName = (user.user_metadata && user.user_metadata.name) || (user.email || '').split('@')[0];
        const { data: created } = await sb.from('profiles')
          .upsert({ id: user.id, email: user.email, name: fallbackName })
          .select()
          .single();
        prof = created;
      }
    } catch (e) {
      console.warn('Potok profile:', e);
    }

    account = {
      id: user.id,
      email: user.email || '',
      name: (prof && prof.name) || (user.user_metadata && user.user_metadata.name) || (user.email || '').split('@')[0],
      createdAt: (prof && prof.created_at) || user.created_at || new Date().toISOString(),
    };
    renderAccountBtn();

    await loadStreams();

    if (!streams.length) {
      const localHasData = state.transactions.length > 0 || !!state.goal;
      const { data: id, error } = await sb.rpc('create_stream', { p_name: 'Мой поток' });
      if (error) throw error;
      await loadStreams();
      const meta = streams.find(function (s) { return s.id === id; }) ||
        { id: id, name: 'Мой поток', owner_id: user.id };
      activeStream = meta;
      try { localStorage.setItem(ACTIVE_STREAM_KEY, meta.id); } catch (e) { /* ignore */ }

      if (localHasData) {
        await saveCloudState();
        subscribeStream();
        refresh();
      } else {
        await loadStream(meta.id);
      }
    } else {
      let savedId = '';
      try { savedId = localStorage.getItem(ACTIVE_STREAM_KEY) || ''; } catch (e) { /* ignore */ }
      const meta = streams.find(function (s) { return s.id === savedId; }) || streams[0];
      await loadStream(meta.id);
    }

    if (inviteRef) {
      const code = inviteRef;
      inviteRef = '';
      await joinInvite(code);
    }

    renderStreamName();
    refresh();
  } catch (e) {
    console.warn('Potok sign in:', e);
    toast('Не удалось загрузить аккаунт');
  } finally {
    authLoading = false;
  }
}

function handleSignedOut() {
  authUser = null;
  account = null;
  streams = [];
  activeStream = null;
  if (sb && realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  try { localStorage.removeItem(ACTIVE_STREAM_KEY); } catch (e) { /* ignore */ }
  state = emptyState();
  persistState(state);
  renderAccountBtn();
  renderStreamName();
  refresh();
}

async function initCloud() {
  renderStreamName();
  if (!sb) return;

  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session && data.session.user) {
      await handleSignedIn(data.session.user);
    }
  } catch (e) {
    console.warn('Potok session:', e);
  }

  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_OUT') {
      handleSignedOut();
      return;
    }
    if (session && session.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
      if (!authUser || authUser.id !== session.user.id || !account) {
        handleSignedIn(session.user);
      } else if (inviteRef) {
        const code = inviteRef;
        inviteRef = '';
        joinInvite(code);
      }
    }
  });
}

/* ---------- валюта ---------- */

function currencyRateLabel(info) {
  if (info.code === 'RUB') return 'базовая валюта';
  return '1 ' + info.symbol + ' = ' + String(info.rubPerUnit).replace('.', ',') + ' ₽';
}

function openCurrencySheet() {
  const rows = Object.keys(CURRENCIES).map(function (code) {
    const c = CURRENCIES[code];
    return '<button class="cur-option' + (state.currency === code ? ' is-active' : '') + '" type="button" data-cur="' + code + '" aria-pressed="' + (state.currency === code) + '">' +
      '<span class="cur-sym">' + esc(c.symbol) + '</span>' +
      '<span class="cur-meta"><b>' + esc(c.name) + '</b>' +
        '<small>' + esc(c.short) + ' · ' + esc(currencyRateLabel(c)) + '</small></span>' +
      '<span class="cur-check" aria-hidden="true">✓</span>' +
    '</button>';
  }).join('');

  openSheet(
    '<div class="sheet-handle"></div>' +
    '<h2>Валюта</h2>' +
    '<p class="sheet-sub">Выберите, в чём показывать суммы. Все операции хранятся в рублях и пересчитываются автоматически.</p>' +
    '<div class="cur-list">' + rows + '</div>' +
    '<p class="auth-note">Курсы фиксированные, для демо: 1 € = 100 ₽, 1 $ = 90 ₽, 1 сербский динар = 0,85 ₽. Курс не обновляется из интернета.</p>'
  );

  document.querySelectorAll('[data-cur]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.currency = btn.dataset.cur;
      persist();
      closeSheet();
      refresh();
      toast('Валюта: ' + CURRENCIES[state.currency].name);
    });
  });
}

/* ---------- меню ---------- */

function openMenu() {
  const profile = account
    ? '<button class="menu-profile" type="button" id="menuProfile">' +
        '<span class="avatar-big">' + esc(accountInitial(account.name || account.email)) + '</span>' +
        '<span class="mp-info"><b>' + esc(account.name) + '</b><small>' + esc(account.email) + '</small></span>' +
        '<span class="mp-chev">›</span>' +
      '</button>'
    : '<button class="menu-profile" type="button" id="menuProfile">' +
        '<span class="avatar-big guest">@</span>' +
        '<span class="mp-info"><b>Войти по почте</b><small>Профиль, приглашения и друзья</small></span>' +
        '<span class="mp-chev">›</span>' +
      '</button>';

  const cur = activeCurrency();

  openSheet(
    '<div class="sheet-handle"></div>' +
    profile +
    '<button class="menu-currency" type="button" id="menuStreams">' +
      '<span class="mc-symbol">◇</span>' +
      '<span class="mp-info"><b>Потоки</b><small>' + (activeStream ? esc(activeStream.name) : 'Выбрать или создать') + '</small></span>' +
      '<span class="mp-chev">›</span>' +
    '</button>' +
    '<button class="menu-currency" type="button" id="menuCurrency">' +
      '<span class="mc-symbol">' + esc(cur.symbol) + '</span>' +
      '<span class="mp-info"><b>Валюта</b><small>' + esc(cur.name) + ' · ' + esc(cur.short) + '</small></span>' +
      '<span class="mp-chev">›</span>' +
    '</button>' +
    '<h2>Настройки</h2>' +
    '<p class="sheet-sub">' + (account
      ? 'Данные синхронизируются с облаком и доступны на других устройствах.'
      : 'Войдите по почте, чтобы сохранять данные и приглашать друзей.') + '</p>' +
    '<button class="btn ghost" type="button" id="menuInvite" style="margin-bottom:8px">🎁 Пригласить друга</button>' +
    '<button class="btn ghost danger" type="button" id="clearAll">Очистить все данные</button>' +
    '<p class="sheet-sub" style="margin-top:18px;text-align:center;font-size:10.5px">Поток · личный учёт денег</p>'
  );

  $('#menuProfile').addEventListener('click', function () {
    if (account) openAccountSheet();
    else openAuthSheet('login');
  });

  $('#menuStreams').addEventListener('click', openStreamsSheet);
  $('#menuCurrency').addEventListener('click', openCurrencySheet);

  $('#menuInvite').addEventListener('click', function () {
    if (account) openInviteSheet();
    else openAuthSheet('login');
  });

  $('#clearAll').addEventListener('click', function () {
    const shared = account && activeStream;
    const question = shared
      ? 'Очистить все операции и цель в потоке «' + activeStream.name + '»? Это увидят все участники. Отменить будет нельзя.'
      : 'Удалить все операции и цель? Отменить это будет нельзя.';
    if (!window.confirm(question)) return;
    state = emptyState();
    persist();
    closeSheet();
    refresh();
    switchTab('home');
    toast('Данные очищены');
  });
}

/* ============================================================
   Навигация и обновление
   ============================================================ */

function refresh() {
  renderHome();
  renderGoal();
  renderForecastView();
  renderWaste();
  renderAccountBtn();
  renderStreamName();
}

function switchTab(tab) {
  ui.tab = tab;
  ['home', 'goal', 'forecast', 'waste'].forEach(function (name) {
    const view = $('#view-' + name);
    if (view) view.hidden = name !== tab;
  });
  document.querySelectorAll('.tab').forEach(function (b) {
    b.classList.toggle('is-active', b.dataset.tab === tab);
  });
  const fab = $('#fab');
  if (fab) fab.hidden = tab !== 'home';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   События
   ============================================================ */

$('#view-home').addEventListener('click', function (e) {
  const monthBtn = e.target.closest('[data-month]');
  if (monthBtn && !monthBtn.disabled) {
    ui.month = monthBtn.dataset.month;
    renderHome();
    return;
  }
  const chartBtn = e.target.closest('[data-chart]');
  if (chartBtn) {
    ui.chartType = chartBtn.dataset.chart;
    renderHome();
    return;
  }
  if (e.target.closest('[data-register]')) {
    openRegisterSheet();
    return;
  }
  const row = e.target.closest('[data-tx]');
  if (row) openTxSheet(row.dataset.tx);
});

$('#view-forecast').addEventListener('click', function (e) {
  const quick = e.target.closest('[data-days]');
  if (quick) {
    ui.forecastDate = addDaysDateStr(new Date(), Number(quick.dataset.days));
    renderForecastView();
  }
});

$('#view-forecast').addEventListener('change', function (e) {
  if (e.target.id === 'forecastDateView') {
    ui.forecastDate = e.target.value || addDaysDateStr(new Date(), 30);
    renderForecastView();
  }
});

$('#view-goal').addEventListener('click', function (e) {
  if (e.target.closest('[data-set-goal]') || e.target.closest('[data-edit-goal]')) {
    openGoalSheet();
  }
});

$('#view-waste').addEventListener('click', function (e) {
  const row = e.target.closest('[data-tx]');
  if (row) openTxSheet(row.dataset.tx);
});

$('#view-waste').addEventListener('input', function (e) {
  if (e.target.id === 'customAmount') {
    ui.customAmount = Math.max(1, Math.round(parseAmount(e.target.value)));
    updateCustomResult();
  }
});

$('#view-waste').addEventListener('change', function (e) {
  if (e.target.id === 'customUnit') {
    ui.customUnit = e.target.value;
    updateCustomResult();
  }
});

function updateCustomResult() {
  const el = $('#customResult');
  if (!el) return;
  el.textContent = money(customSavings(wasteStats()));
}

document.querySelectorAll('.tab').forEach(function (b) {
  b.addEventListener('click', function () { switchTab(b.dataset.tab); });
});

$('#fab').addEventListener('click', openAddSheet);
$('#menuBtn').addEventListener('click', openMenu);
$('#accountBtn').addEventListener('click', function () {
  if (account) openAccountSheet();
  else openAuthSheet('login');
});

$('#streamBtn').addEventListener('click', function () {
  if (account) openStreamsSheet();
  else openAuthSheet('login');
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeSheet();
});

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') flushCloudSave();
});

/* ============================================================
   Старт
   ============================================================ */

refresh();
renderAccountBtn();
renderStreamName();
switchTab('home');
initCloud();
