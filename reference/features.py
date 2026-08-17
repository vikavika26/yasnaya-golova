"""Сборка таблицы «день × факторы» и реестр проверяемых гипотез.

Два принципиальных решения, из-за которых выводы отличаются от обычных дневников:

1. Факторы проверяются со сдвигом. Провокатор действует не в тот же час, а за
   6-48 часов, поэтому у каждой гипотезы есть лаг.
2. Признаки, которые человек отмечает ТОЛЬКО в дни боли (стресс, мало сна,
   нагрузки), нельзя использовать как предикторы: в дни без боли их просто не
   спрашивали. Считать по ним риск — значит гарантированно получить «виновен».
   Такие признаки помечены как needs_daily и попадают не в выводы, а в
   предложение начать отмечать их каждый день.
"""
import numpy as np
import pandas as pd

from . import db, weather

# Признаки, которые Мигребот собирает только в дни приступа → как триггеры непроверяемы
SELF_ONLY = ["Стресс", "Мало сна", "Много сна", "Физ. нагрузки", "Умственные нагрузки",
             "Духота", "Голод", "Алкоголь", "Кофе", "Шоколад", "Болезнь", "Погода",
             "Менструация", "Гормоны", "Температура", "Обезвоживание", "Свет", "Шум"]


def entries_frame() -> pd.DataFrame:
    with db.connect() as con:
        df = pd.read_sql_query("SELECT * FROM entries ORDER BY date", con)
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"])
    return df


def build() -> pd.DataFrame:
    """Дневник + погода + производные признаки, по одной строке на день."""
    e = entries_frame()
    if e.empty:
        return e
    w = weather.as_frame()

    # непрерывный календарь: пропущенные дни дневника остаются с headache = NaN
    idx = pd.date_range(e["date"].min(), max(e["date"].max(), w["date"].max() if not w.empty
                                             else e["date"].max()), freq="D")
    d = pd.DataFrame({"date": idx}).merge(e, on="date", how="left")
    if not w.empty:
        d = d.merge(w.drop(columns=["kind"], errors="ignore"), on="date", how="left")

    # --- цикл: день от начала менструации -------------------------------------
    mens = d["mens"].fillna(0).to_numpy()
    starts = np.zeros(len(d), bool)
    for i in range(len(d)):
        if mens[i] == 1 and (i == 0 or mens[i - 1] == 0):
            starts[i] = True
    cycle_day = np.full(len(d), np.nan)
    last = None
    for i in range(len(d)):
        if starts[i]:
            last = i
        if last is not None:
            cycle_day[i] = i - last
    d["cycle_day"] = cycle_day
    peri = np.zeros(len(d), bool)
    for i in np.where(starts)[0]:
        for k in range(-2, 3):
            if 0 <= i + k < len(d):
                peri[i + k] = True
    d["peri"] = peri
    d["mens_day"] = mens.astype(bool)

    # --- погода: важны перепады, а не абсолютные значения ---------------------
    for col, name in [("p_mean", "p"), ("t_mean", "t")]:
        if col in d:
            d[f"{name}_delta"] = d[col].diff()
    if "p_max" in d and "p_min" in d:
        d["p_swing"] = d["p_max"] - d["p_min"]

    # --- календарь и инерция боли --------------------------------------------
    d["weekday"] = d["date"].dt.weekday
    d["is_weekend"] = d["weekday"].isin([5, 6])
    d["prev_headache"] = d["headache"].shift(1)

    # --- что человек сам назвал причиной -------------------------------------
    d["self_list"] = d["self_triggers"].fillna("").apply(
        lambda s: [t.strip() for t in str(s).split(",") if t.strip()])
    return d


def _q(series: pd.Series, q: float) -> float | None:
    v = series.dropna()
    return float(v.quantile(q)) if len(v) > 20 else None


def factor_defs(d: pd.DataFrame) -> list[dict]:
    """Заранее зафиксированный список гипотез.

    Список фиксируется ДО подсчёта — как в клиническом исследовании. Иначе
    поправка на множественные сравнения не имеет смысла: перебрав достаточно
    вариантов, «значимость» находится всегда.
    """
    F: list[dict] = []

    def add(key, label, mask, group, lag=0, hint=""):
        F.append({"key": key, "label": label, "mask": mask, "group": group,
                  "lag": lag, "hint": hint})

    # цикл
    add("peri", "Перименструальное окно (±2 дня от начала)", d["peri"], "Цикл",
        hint="Самая частая связь при мигрени у женщин — падение эстрогена перед менструацией.")
    add("mens_day", "День менструации", d["mens_day"], "Цикл")

    # давление: перепады со сдвигами
    if "p_delta" in d:
        for lag in (0, 1, 2):
            add(f"p_drop_l{lag}", f"Падение давления ≥5 гПа за сутки"
                + (f" (за {lag} дн. до)" if lag else ""),
                d["p_delta"].shift(lag) <= -5, "Погода", lag,
                hint="Проверяется перепад, а не абсолютное давление: организм реагирует на изменение.")
        add("p_rise_l0", "Рост давления ≥5 гПа за сутки", d["p_delta"] >= 5, "Погода")
        add("p_drop_strong", "Резкое падение ≥10 гПа за сутки", d["p_delta"] <= -10, "Погода")
    if "p_swing" in d:
        for lag in (0, 1):
            add(f"p_swing_l{lag}", "Скачки давления внутри суток ≥10 гПа"
                + (f" (за {lag} дн. до)" if lag else ""),
                d["p_swing"].shift(lag) >= 10, "Погода", lag)
    if "p_mean" in d:
        lo = _q(d["p_mean"], 0.2)
        if lo:
            add("p_low", "Низкое давление (пятая часть самых низких дней)",
                d["p_mean"] <= lo, "Погода")
    if "t_delta" in d:
        add("t_jump", "Перепад температуры ≥5 °C за сутки", d["t_delta"].abs() >= 5, "Погода")
    if "rh_mean" in d:
        hi = _q(d["rh_mean"], 0.8)
        if hi:
            add("rh_high", "Высокая влажность (пятая часть самых влажных дней)",
                d["rh_mean"] >= hi, "Погода")
    if "wind_max" in d:
        hi = _q(d["wind_max"], 0.8)
        if hi:
            add("wind_high", "Сильный ветер (пятая часть самых ветреных дней)",
                d["wind_max"] >= hi, "Погода")
    if "precip" in d:
        add("precip", "Осадки более 1 мм", d["precip"] >= 1, "Погода")

    # календарь
    add("weekend", "Выходной день", d["is_weekend"], "Режим",
        hint="Классический «мигрень выходного дня»: сдвиг режима сна и отмена кофеина.")
    add("monday", "Понедельник", d["weekday"] == 0, "Режим")

    # инерция
    add("prev_day", "Боль была вчера", d["prev_headache"] == 1, "Инерция",
        hint="Не триггер, а затяжной приступ. Учитывается, чтобы не завышать значимость остального.")
    return F


def daily_missing(d: pd.DataFrame) -> list[str]:
    """Что человек называл причиной, но проверить нельзя — нет отметок в дни без боли."""
    named = set()
    for lst in d["self_list"].dropna():
        named.update(lst)
    return sorted(named & set(SELF_ONLY))
