"""Локальное хранилище. Всё в одном SQLite-файле рядом с приложением —
медицинские данные не покидают компьютер."""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "golova.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    date        TEXT PRIMARY KEY,   -- YYYY-MM-DD
    headache    INTEGER NOT NULL,   -- 0/1
    intensity   REAL,               -- 1..10
    mens        INTEGER,            -- 0/1, день менструации
    med_taken   INTEGER,            -- 0/1
    med_text    TEXT,
    med_helped  TEXT,               -- помогло / немного помогло / не помогло
    nausea      INTEGER,
    photophobia INTEGER,
    phonophobia INTEGER,
    location    TEXT,
    pain_char   TEXT,
    loads       INTEGER,
    self_triggers TEXT,             -- то, что человек сам считает причиной, через запятую
    pain_start  TEXT,
    pain_end    TEXT,
    comment     TEXT,
    source      TEXT DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS weather (
    date     TEXT PRIMARY KEY,
    p_mean   REAL, p_min REAL, p_max REAL,
    t_mean   REAL, t_min REAL, t_max REAL,
    rh_mean  REAL, wind_max REAL, precip REAL,
    kind     TEXT               -- archive / forecast
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

DEFAULTS = {
    "city": "Санкт-Петербург",
    "lat": "59.9386",
    "lon": "30.3141",
    "tz": "Europe/Moscow",
}


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


def init() -> None:
    with connect() as con:
        con.executescript(SCHEMA)
        for k, v in DEFAULTS.items():
            con.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v))


def get_setting(key: str, default: str | None = None) -> str | None:
    with connect() as con:
        row = con.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with connect() as con:
        con.execute(
            "INSERT INTO settings(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )


ENTRY_FIELDS = [
    "date", "headache", "intensity", "mens", "med_taken", "med_text", "med_helped",
    "nausea", "photophobia", "phonophobia", "location", "pain_char", "loads",
    "self_triggers", "pain_start", "pain_end", "comment", "source",
]


def upsert_entries(rows: list[dict]) -> int:
    """Пишет записи дневника. Существующие даты обновляются — импорт идемпотентен."""
    cols = ", ".join(ENTRY_FIELDS)
    marks = ", ".join("?" for _ in ENTRY_FIELDS)
    updates = ", ".join(f"{c} = excluded.{c}" for c in ENTRY_FIELDS if c != "date")
    sql = (f"INSERT INTO entries ({cols}) VALUES ({marks}) "
           f"ON CONFLICT(date) DO UPDATE SET {updates}")
    payload = [tuple(r.get(c) for c in ENTRY_FIELDS) for r in rows]
    with connect() as con:
        con.executemany(sql, payload)
    return len(payload)


def upsert_weather(rows: list[dict]) -> int:
    cols = ["date", "p_mean", "p_min", "p_max", "t_mean", "t_min", "t_max",
            "rh_mean", "wind_max", "precip", "kind"]
    marks = ", ".join("?" for _ in cols)
    updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c != "date")
    sql = (f"INSERT INTO weather ({', '.join(cols)}) VALUES ({marks}) "
           f"ON CONFLICT(date) DO UPDATE SET {updates}")
    payload = [tuple(r.get(c) for c in cols) for r in rows]
    with connect() as con:
        con.executemany(sql, payload)
    return len(payload)


def entries_range() -> tuple[str | None, str | None]:
    with connect() as con:
        row = con.execute("SELECT MIN(date) a, MAX(date) b FROM entries").fetchone()
    return (row["a"], row["b"]) if row else (None, None)


def weather_range() -> tuple[str | None, str | None]:
    with connect() as con:
        row = con.execute(
            "SELECT MIN(date) a, MAX(date) b FROM weather WHERE kind = 'archive'"
        ).fetchone()
    return (row["a"], row["b"]) if row else (None, None)


def counts() -> dict:
    with connect() as con:
        e = con.execute(
            "SELECT COUNT(*) n, SUM(headache) h FROM entries"
        ).fetchone()
        w = con.execute("SELECT COUNT(*) n FROM weather").fetchone()
    return {"entries": e["n"] or 0, "headache_days": e["h"] or 0, "weather_days": w["n"] or 0}
