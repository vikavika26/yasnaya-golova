"""Импорт выгрузки Мигребота (.xlsx, лист «Записи опросов»).

Мигребот хранит день как строку опроса: заполнены поля приступа только в дни
с болью. Здесь всё приводится к плоскому виду «день → признаки», потому что
для статистики нужны и дни без боли тоже.
"""
import re
import pandas as pd

from . import db

SHEET_CANDIDATES = ["Записи опросов", "Записи", 0]

COLMAP = {
    "Дата": "date",
    "Головная боль": "headache",
    "Менструальный цикл": "mens",
    "Принятые медикаменты": "med_raw",
    "Интенсивность боли": "intensity",
    "Локализация": "location",
    "Характер": "pain_char",
    "Нагрузки": "loads",
    "Тошнота": "nausea",
    "ФоТофобия": "photophobia",
    "ФоНофобия": "phonophobia",
    "Триггеры": "self_triggers",
    "Начало боли": "pain_start",
    "Окончание боли": "pain_end",
    "Комментарии": "comment",
}

HELP_WORDS = ["не помогло", "немного помогло", "помогло"]


def _yes(v) -> int | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip().lower()
    if s in ("да", "yes", "true", "1"):
        return 1
    if s in ("нет", "no", "false", "0"):
        return 0
    return None


def _parse_meds(raw) -> tuple[int, str | None, str | None]:
    """«Цитрамон 2 таб, Помогло» → (принимала, текст, эффект).

    Мигребот кладёт несколько приёмов за день в одну ячейку через перевод строки.
    Эффект берём самый слабый из указанных — так честнее для оценки лечения.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return 0, None, None
    s = str(raw).strip()
    if not s or s.lower() == "нет":
        return 0, None, None
    effects = []
    for part in re.split(r"[\n;]+", s):
        low = part.lower()
        for w in HELP_WORDS:                 # порядок важен: «не помогло» до «помогло»
            if w in low:
                effects.append(w)
                break
    effect = None
    for w in HELP_WORDS:                     # самый слабый эффект из встреченных
        if w in effects:
            effect = w
            break
    drug = re.sub(r"\s*,?\s*(не\s+)?(немного\s+)?помогло", "", s, flags=re.I)
    drug = re.sub(r"\s+", " ", drug.replace("\n", "; ")).strip(" ;,")
    return 1, drug or None, effect


def read_sheet(path: str) -> pd.DataFrame:
    xl = pd.ExcelFile(path)
    for cand in SHEET_CANDIDATES:
        name = cand if isinstance(cand, str) else xl.sheet_names[cand]
        if name in xl.sheet_names:
            return xl.parse(name)
    raise ValueError(f"Не нашла лист с записями. Есть: {xl.sheet_names}")


def import_file(path: str) -> dict:
    raw = read_sheet(path)
    missing = [c for c in ("Дата", "Головная боль") if c not in raw.columns]
    if missing:
        raise ValueError(f"В файле нет обязательных колонок: {missing}")

    df = raw.rename(columns={k: v for k, v in COLMAP.items() if k in raw.columns})
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).sort_values("date")

    rows = []
    for _, r in df.iterrows():
        taken, drug, effect = _parse_meds(r.get("med_raw"))
        headache = _yes(r.get("headache"))
        if headache is None:
            continue                          # без ответа про боль день бесполезен
        trig = r.get("self_triggers")
        rows.append({
            "date": r["date"].strftime("%Y-%m-%d"),
            "headache": headache,
            "intensity": None if pd.isna(r.get("intensity")) else float(r["intensity"]),
            "mens": _yes(r.get("mens")),
            "med_taken": taken,
            "med_text": drug,
            "med_helped": effect,
            "nausea": _yes(r.get("nausea")),
            "photophobia": _yes(r.get("photophobia")),
            "phonophobia": _yes(r.get("phonophobia")),
            "location": None if pd.isna(r.get("location")) else str(r["location"]).strip(),
            "pain_char": None if pd.isna(r.get("pain_char")) else str(r["pain_char"]).strip(),
            "loads": _yes(r.get("loads")),
            "self_triggers": None if pd.isna(trig) else str(trig).strip(),
            "pain_start": None if pd.isna(r.get("pain_start")) else str(r["pain_start"]).strip(),
            "pain_end": None if pd.isna(r.get("pain_end")) else str(r["pain_end"]).strip(),
            "comment": None if pd.isna(r.get("comment")) else str(r["comment"]).strip(),
            "source": "migrebot",
        })

    db.upsert_entries(rows)
    dates = [r["date"] for r in rows]
    return {
        "imported": len(rows),
        "headache_days": sum(r["headache"] for r in rows),
        "date_from": min(dates) if dates else None,
        "date_to": max(dates) if dates else None,
    }
