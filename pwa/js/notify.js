/**
 * Напоминания отметить день.
 *
 * Без них дневник забрасывают через неделю, и вся статистика умирает — это
 * главное, за что держатся в Мигреботе, где пишет бот.
 *
 * Приложение собрано без сборщика, поэтому npm-обёртку плагина импортировать
 * нельзя: браузер не умеет разрешать bare-спецификаторы. Зато Capacitor
 * выкладывает нативные плагины в `window.Capacitor.Plugins`, и обращаться туда
 * напрямую — законный способ. В обычном браузере плагина нет, тогда работаем
 * через веб-уведомления, а если и их нет — молча ничего не делаем.
 */

const ID = 1042;               // фиксированный id, чтобы перепланировать, а не плодить

const native = () => window.Capacitor?.Plugins?.LocalNotifications ?? null;

export function isSupported() {
  return !!native() || 'Notification' in window;
}

export function isNative() {
  return !!native();
}

/** Спрашиваем разрешение только когда человек сам включает напоминания. */
export async function requestPermission() {
  const plugin = native();
  if (plugin) {
    const res = await plugin.requestPermissions();
    return res?.display === 'granted';
  }
  if (!('Notification' in window)) return false;
  const res = await Notification.requestPermission();
  return res === 'granted';
}

/**
 * Ставит ежедневное напоминание на указанное время.
 * @param {string} hhmm — «21:30»
 */
export async function schedule(hhmm) {
  const plugin = native();
  if (!plugin) return false;                       // в браузере расписание не поддержим
  const [hour, minute] = hhmm.split(':').map(Number);
  await plugin.cancel({ notifications: [{ id: ID }] });
  await plugin.schedule({
    notifications: [{
      id: ID,
      title: 'Как прошёл день?',
      body: 'Отметь, болела ли голова — даже если всё было хорошо.',
      schedule: { on: { hour, minute }, allowWhileIdle: true, repeats: true },
      smallIcon: 'ic_launcher',
    }],
  });
  return true;
}

export async function cancel() {
  const plugin = native();
  if (plugin) await plugin.cancel({ notifications: [{ id: ID }] });
}

/** Приводит расписание в соответствие с настройками — вызывается на старте. */
export async function sync({ enabled, time }) {
  if (!native()) return { ok: false, reason: 'браузер' };
  try {
    if (!enabled) { await cancel(); return { ok: true, scheduled: false }; }
    const granted = await hasPermission();
    if (!granted) return { ok: false, reason: 'нет разрешения' };
    await schedule(time);
    return { ok: true, scheduled: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function hasPermission() {
  const plugin = native();
  if (!plugin) return false;
  const res = await plugin.checkPermissions();
  return res?.display === 'granted';
}
