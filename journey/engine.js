/* Движок демо «personal journey».
 *
 * 🔑 Здесь НЕТ ни одного вызова LLM — и это главное утверждение страницы.
 * Решения принимают профиль и правила; языковой модели в таком продукте достаётся
 * формулировка, а не выбор. Поэтому каждое правило возвращает свой идентификатор,
 * и страница показывает, какое именно сработало.
 *
 * Профиль — схема с полями и происхождением каждого поля (из какого ответа взялось),
 * а не история переписки. Это второе отличие продукта от обёртки над моделью.
 */
(function (global) {
  'use strict';

  /* ─────────────── Опрос: ветвление зависит от уже данных ответов ─────────────── */

  const QUESTIONS = [
    {
      id: 'level',
      t: { he: 'כמה אתה בתנועה בשבוע רגיל היום?', en: 'How much do you move in a typical week right now?' },
      options: [
        { v: 'none', he: 'כמעט בכלל לא', en: 'Almost not at all' },
        { v: 'some', he: 'פעם-פעמיים', en: 'Once or twice' },
        { v: 'regular', he: 'שלוש פעמים ומעלה', en: 'Three times or more' },
      ],
    },
    {
      id: 'goal',
      // Вопрос меняется по предыдущему ответу — это и есть «динамический опрос»
      t: {
        he: 'מה המטרה הקרובה?', en: 'What is the near-term goal?',
      },
      optionsFor: a => a.level === 'regular'
        ? [
            { v: 'keep', he: 'לא לאבד את הרצף', en: 'Not to lose the streak' },
            { v: 'more', he: 'להוסיף אימון אחד בשבוע', en: 'Add one session a week' },
          ]
        : [
            { v: 'start', he: 'פשוט להתחיל ולא ליפול', en: 'Just start and not fall off' },
            { v: 'back', he: 'לחזור אחרי הפסקה ארוכה', en: 'Come back after a long break' },
          ],
    },
    {
      id: 'barrier',
      t: { he: 'מה עוצר אותך בפועל?', en: 'What actually stops you?' },
      options: [
        { v: 'time', he: 'אין חלון זמן', en: 'No window of time' },
        { v: 'energy', he: 'בערב כבר אין כוח', en: 'By evening there is no energy left' },
        { v: 'boring', he: 'לבד זה משעמם', en: 'Alone it is boring' },
        { v: 'restart', he: 'מתחיל ונוטש אחרי שבוע', en: 'I start and quit after a week' },
      ],
    },
    {
      id: 'window',
      t: { he: 'מתי באמת פנוי?', en: 'When are you actually free?' },
      options: [
        { v: 'morning', he: 'בוקר', en: 'Morning' },
        { v: 'midday', he: 'אמצע היום', en: 'Midday' },
        { v: 'evening', he: 'ערב', en: 'Evening' },
      ],
    },
    {
      id: 'place',
      t: { he: 'איפה נוח?', en: 'Where is it convenient?' },
      options: [
        { v: 'home', he: 'בבית', en: 'At home' },
        { v: 'outside', he: 'בחוץ', en: 'Outdoors' },
        { v: 'gym', he: 'בחדר כושר', en: 'At a gym' },
      ],
    },
    {
      id: 'gym_access',
      // Появляется только для выбравших зал — ветка, которой остальные не видят
      showIf: a => a.place === 'gym',
      t: { he: 'יש מנוי פעיל עכשיו?', en: 'Do you have an active membership right now?' },
      options: [
        { v: 'yes', he: 'כן', en: 'Yes' },
        { v: 'no', he: 'לא', en: 'No' },
      ],
    },
    {
      id: 'minutes',
      t: { he: 'כמה דקות ריאליות לפעם?', en: 'How many minutes per session is realistic?' },
      options: [
        { v: '10', he: 'עד 10', en: 'Up to 10' },
        { v: '20', he: 'בערך 20', en: 'About 20' },
        { v: '40', he: '40 ומעלה', en: '40 or more' },
      ],
    },
    {
      id: 'failed',
      t: { he: 'מה כבר ניסית ונטשת?', en: 'What have you already tried and dropped?' },
      options: [
        { v: 'gym_sub', he: 'מנוי לחדר כושר', en: 'A gym membership' },
        { v: 'running', he: 'ריצה', en: 'Running' },
        { v: 'morning_routine', he: 'התעמלות בוקר', en: 'A morning routine' },
        { v: 'nothing', he: 'כלום', en: 'Nothing' },
      ],
    },
  ];

  function visibleQuestions(answers) {
    return QUESTIONS.filter(q => !q.showIf || q.showIf(answers));
  }
  function optionsOf(q, answers) {
    return q.optionsFor ? q.optionsFor(answers) : q.options;
  }

  /* ─────────────── Профиль: поля со схемой и происхождением ─────────────── */

  const FIELD_LABELS = {
    level:    { he: 'רמת פעילות', en: 'Activity level' },
    goal:     { he: 'מטרה', en: 'Goal' },
    barrier:  { he: 'חסם עיקרי', en: 'Main barrier' },
    window:   { he: 'חלון זמן', en: 'Time window' },
    place:    { he: 'מקום', en: 'Place' },
    minutes:  { he: 'אורך מפגש', en: 'Session length' },
    failed:   { he: 'כבר לא עבד', en: 'Already did not work' },
    capacity: { he: 'קיבולת שבועית', en: 'Weekly capacity' },
  };

  /** Профиль строится правилами, а не пересказом ответов: capacity — вывод, а не ответ. */
  function buildProfile(answers) {
    const p = {};
    const put = (k, v, from) => { p[k] = { value: v, from }; };
    for (const k of ['level', 'goal', 'barrier', 'window', 'place', 'minutes', 'failed']) {
      if (answers[k] !== undefined) put(k, answers[k], k);
    }
    if (answers.gym_access === 'no' && answers.place === 'gym') {
      p.place = { value: 'home', from: 'gym_access', derived: true };
    }
    const base = answers.level === 'regular' ? 4 : answers.level === 'some' ? 3 : 2;
    const cut = (answers.barrier === 'time' || answers.barrier === 'energy') ? 1 : 0;
    put('capacity', Math.max(2, base - cut), 'derived');
    p.capacity.derived = true;
    return p;
  }

  /* ─────────────── Правила плана: каждое со своим id ─────────────── */

  const RULES = [
    {
      id: 'R1',
      when: p => p.barrier.value === 'time',
      action: {
        he: 'שתי יחידות של {min} דקות, מוצמדות למשהו שכבר קורה בכל יום',
        en: 'Two blocks of {min} minutes, attached to something that already happens daily',
      },
      why: { he: 'החסם הוא חלון זמן, ולכן קודם מקצרים ומצמידים להרגל קיים',
             en: 'The barrier is the time window, so first shorten and attach to an existing habit' },
    },
    {
      id: 'R2',
      when: p => p.barrier.value === 'energy',
      action: { he: 'להעביר את המפגש לחלון {window} — לפני שהיום מרוקן אותך',
                en: 'Move the session to the {window} window — before the day drains you' },
      why: { he: 'החסם הוא כוח בערב, ולכן משנים את השעה ולא את התוכן',
             en: 'The barrier is evening energy, so we change the hour, not the content' },
    },
    {
      id: 'R3',
      when: p => p.barrier.value === 'boring',
      action: { he: 'לקבוע מפגש אחד בשבוע עם מישהו — או שיחה בטלפון תוך כדי הליכה',
                en: 'Book one session a week with someone — or a phone call while walking' },
      why: { he: 'החסם חברתי, ולכן הפתרון חברתי ולא אימוני',
             en: 'The barrier is social, so the fix is social, not athletic' },
    },
    {
      id: 'R4',
      when: p => p.barrier.value === 'restart',
      action: { he: 'מינימום יומי שקשה לפספס: {min} דקות, כל יום, גם כשלא בא',
                en: 'A daily minimum that is hard to miss: {min} minutes, every day, even when you do not feel like it' },
      why: { he: 'הבעיה היא נטישה אחרי שבוע, ולכן קודם רצף ורק אחר כך עומס',
             en: 'The problem is quitting after a week, so streak first and load later' },
    },
    {
      id: 'R5',
      when: p => p.capacity.value >= 3,
      action: { he: 'להוסיף מפגש שלישי באותו חלון', en: 'Add a third session in the same window' },
      why: { he: 'הקיבולת השבועית מאפשרת שלושה', en: 'Weekly capacity allows three' },
    },
    {
      id: 'R6',
      when: p => p.place.value === 'home',
      action: { he: 'אימון ביתי בלי ציוד — כדי שלא יהיה תירוץ של מקום',
                en: 'A home session with no equipment — so place is never the excuse' },
      why: { he: 'המקום נבחר בבית (או הופק מכך שאין מנוי פעיל)',
             en: 'Place resolved to home (or was derived from having no active membership)' },
    },
  ];

  /** Что человек уже бросал — то не предлагаем. Это тоже правило, и оно видно. */
  const EXCLUSIONS = {
    gym_sub: { rule: 'X1', he: 'לא מציע מנוי לחדר כושר — כבר ננטש',
               en: 'Not proposing a gym membership — it was already dropped' },
    running: { rule: 'X2', he: 'לא מציע ריצה — כבר ננטשה',
               en: 'Not proposing running — it was already dropped' },
    morning_routine: { rule: 'X3', he: 'לא מציע התעמלות בוקר קלאסית — כבר ננטשה',
                       en: 'Not proposing a classic morning routine — it was already dropped' },
  };

  /** Подставляем только числа. {window} остаётся плейсхолдером: у него есть перевод,
   *  и подставлять надо переведённое значение — иначе в иврите вылезет «morning». */
  function fill(str, p) {
    return str.replace('{min}', p.minutes ? p.minutes.value : '10');
  }

  function buildPlan(profile) {
    const fired = RULES.filter(r => r.when(profile));
    // Языки перебираем по ключам, а не списком: иначе добавленный язык тихо теряется
    // (так и вышло с русским — тексты были, а в плане оставались he и en).
    const actions = fired.slice(0, 3).map(r => {
      const action = {};
      Object.keys(r.action).forEach(l => { action[l] = fill(r.action[l], profile); });
      return { rule: r.id, action, why: r.why };
    });
    const excl = profile.failed && EXCLUSIONS[profile.failed.value]
      ? EXCLUSIONS[profile.failed.value] : null;
    return { actions, nba: actions[0] || null, exclusion: excl, capacity: profile.capacity.value };
  }

  /* ─────────────── Чекпойнт: дельта профиля → дельта плана ─────────────── */

  const CHECKPOINT = [
    {
      id: 'done',
      t: { he: 'כמה מפגשים באמת קרו השבוע?', en: 'How many sessions actually happened this week?' },
      options: [
        { v: '0', he: 'אף אחד', en: 'None' },
        { v: 'some', he: 'חלק', en: 'Some of them' },
        { v: 'all', he: 'הכול', en: 'All of them' },
      ],
    },
    {
      id: 'blocker_now',
      t: { he: 'מה הפריע השבוע?', en: 'What got in the way this week?' },
      options: [
        { v: 'same', he: 'אותו דבר כמו קודם', en: 'The same thing as before' },
        { v: 'energy', he: 'לא היה כוח', en: 'No energy' },
        { v: 'time', he: 'לא היה זמן', en: 'No time' },
        { v: 'none', he: 'כלום, פשוט הלך', en: 'Nothing, it just worked' },
      ],
    },
    {
      id: 'window_now',
      t: { he: 'חלון הזמן נשאר אותו חלון?', en: 'Is the time window still the same?' },
      options: [
        { v: 'same', he: 'כן', en: 'Yes' },
        { v: 'morning', he: 'עבר לבוקר', en: 'Moved to morning' },
        { v: 'evening', he: 'עבר לערב', en: 'Moved to evening' },
      ],
    },
  ];

  /** Новый профиль = старый + дельта. Возвращаем и сам список изменений, чтобы показать «почему». */
  function applyCheckpoint(profile, cp) {
    const next = JSON.parse(JSON.stringify(profile));
    const changes = [];
    if (cp.blocker_now && cp.blocker_now !== 'same' && cp.blocker_now !== 'none'
        && cp.blocker_now !== profile.barrier.value) {
      changes.push({ field: 'barrier', from: profile.barrier.value, to: cp.blocker_now });
      next.barrier = { value: cp.blocker_now, from: 'checkpoint' };
    }
    if (cp.window_now && cp.window_now !== 'same' && cp.window_now !== profile.window.value) {
      changes.push({ field: 'window', from: profile.window.value, to: cp.window_now });
      next.window = { value: cp.window_now, from: 'checkpoint' };
    }
    const cap = profile.capacity.value;
    let newCap = cap;
    if (cp.done === '0') newCap = Math.max(2, cap - 1);
    else if (cp.done === 'all') newCap = Math.min(5, cap + 1);
    if (newCap !== cap) {
      changes.push({ field: 'capacity', from: cap, to: newCap });
      next.capacity = { value: newCap, from: 'checkpoint', derived: true };
    }
    return { profile: next, changes };
  }

  /** Разница двух планов по идентификаторам правил — это и есть «было → стало». */
  function diffPlans(before, after) {
    const idsBefore = before.actions.map(a => a.rule);
    const idsAfter = after.actions.map(a => a.rule);
    return {
      removed: before.actions.filter(a => !idsAfter.includes(a.rule)),
      added: after.actions.filter(a => !idsBefore.includes(a.rule)),
      kept: after.actions.filter(a => idsBefore.includes(a.rule)),
    };
  }

  /* ─────────────── Русский слой ───────────────
   * Добавлен 23.09 по просьбе Сергея: сначала пройти поток на русском, потом судить об иврите.
   * Держим отдельным словарём, а не третьим полем в каждой строке, — иначе структуры выше
   * перестают читаться.
   */
  const RU = {
    q: {
      level: 'Сколько вы двигаетесь за обычную неделю сейчас?',
      goal: 'Какая ближайшая цель?',
      barrier: 'Что на самом деле останавливает?',
      window: 'Когда вы реально свободны?',
      place: 'Где удобно?',
      gym_access: 'Абонемент сейчас действует?',
      minutes: 'Сколько минут за раз — реально?',
      failed: 'Что уже пробовали и бросили?',
    },
    opt: {
      'level.none': 'Почти никак', 'level.some': 'Раз-два в неделю', 'level.regular': 'Три раза и чаще',
      'goal.keep': 'Не потерять регулярность', 'goal.more': 'Добавить одну тренировку в неделю',
      'goal.start': 'Просто начать и не бросить', 'goal.back': 'Вернуться после долгого перерыва',
      'barrier.time': 'Нет окна времени', 'barrier.energy': 'К вечеру уже нет сил',
      'barrier.boring': 'Одному скучно', 'barrier.restart': 'Начинаю и бросаю через неделю',
      'window.morning': 'Утро', 'window.midday': 'Середина дня', 'window.evening': 'Вечер',
      'place.home': 'Дома', 'place.outside': 'На улице', 'place.gym': 'В зале',
      'gym_access.yes': 'Да', 'gym_access.no': 'Нет',
      'minutes.10': 'До 10', 'minutes.20': 'Около 20', 'minutes.40': '40 и больше',
      'failed.gym_sub': 'Абонемент в зал', 'failed.running': 'Бег',
      'failed.morning_routine': 'Утреннюю зарядку', 'failed.nothing': 'Ничего',
      'done.0': 'Ни одной', 'done.some': 'Часть', 'done.all': 'Все',
      'blocker_now.same': 'То же, что и раньше', 'blocker_now.energy': 'Не было сил',
      'blocker_now.time': 'Не было времени', 'blocker_now.none': 'Ничего, всё получилось',
      'window_now.same': 'Да', 'window_now.morning': 'Сдвинулось на утро',
      'window_now.evening': 'Сдвинулось на вечер',
    },
    cp: {
      done: 'Сколько занятий на самом деле случилось за неделю?',
      blocker_now: 'Что помешало на этой неделе?',
      window_now: 'Окно времени осталось тем же?',
    },
    rule: {
      R1: { a: 'Два блока по {min} минут, привязанных к тому, что и так происходит каждый день',
            w: 'Барьер — окно времени, поэтому сначала укорачиваем и цепляем к существующей привычке' },
      R2: { a: 'Перенести занятие в окно «{window}» — до того, как день вас опустошит',
            w: 'Барьер — силы вечером, поэтому меняем час, а не содержание' },
      R3: { a: 'Назначить одно занятие в неделю с кем-то — или телефонный разговор на ходу',
            w: 'Барьер социальный, значит и решение социальное, а не тренировочное' },
      R4: { a: 'Ежедневный минимум, который трудно пропустить: {min} минут каждый день, даже когда не хочется',
            w: 'Проблема — бросить через неделю, поэтому сначала регулярность, нагрузка потом' },
      R5: { a: 'Добавить третье занятие в то же окно', w: 'Недельная ёмкость позволяет три' },
      R6: { a: 'Домашнее занятие без инвентаря — чтобы место не было отговоркой',
            w: 'Место определилось как «дома» (или выведено из того, что абонемента нет)' },
    },
    excl: {
      gym_sub: 'Не предлагаю абонемент в зал — он уже был брошен',
      running: 'Не предлагаю бег — он уже был брошен',
      morning_routine: 'Не предлагаю классическую утреннюю зарядку — она уже была брошена',
    },
    fields: {
      level: 'Уровень активности', goal: 'Цель', barrier: 'Главный барьер', window: 'Окно времени',
      place: 'Место', minutes: 'Длительность', failed: 'Уже не сработало', capacity: 'Недельная ёмкость',
      checkpoint: 'чекпойнт',
    },
  };

  /** Раскладываем русский слой по тем же структурам, чтобы страница не знала об исключениях. */
  (function applyRu() {
    const opt = (qid, o) => { o.ru = RU.opt[qid + '.' + o.v] || o.en; };
    QUESTIONS.forEach(q => {
      q.t.ru = RU.q[q.id] || q.t.en;
      if (q.options) q.options.forEach(o => opt(q.id, o));
      if (q.optionsFor) {
        const orig = q.optionsFor;
        q.optionsFor = a => orig(a).map(o => (opt(q.id, o), o));
      }
    });
    CHECKPOINT.forEach(q => {
      q.t.ru = RU.cp[q.id] || q.t.en;
      q.options.forEach(o => opt(q.id, o));
    });
    RULES.forEach(r => {
      const tr = RU.rule[r.id];
      if (tr) { r.action.ru = tr.a; r.why.ru = tr.w; }
    });
    Object.keys(EXCLUSIONS).forEach(k => { EXCLUSIONS[k].ru = RU.excl[k] || EXCLUSIONS[k].en; });
    Object.keys(FIELD_LABELS).forEach(k => { FIELD_LABELS[k].ru = RU.fields[k] || FIELD_LABELS[k].en; });
    FIELD_LABELS.checkpoint = { he: 'צ׳ק־פוינט', en: 'checkpoint', ru: 'чекпойнт' };
  })();

  global.JOURNEY = {
    QUESTIONS, CHECKPOINT, FIELD_LABELS,
    visibleQuestions, optionsOf, buildProfile, buildPlan, applyCheckpoint, diffPlans,
  };
})(typeof window !== 'undefined' ? window : globalThis);
