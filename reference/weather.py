"""Погода подтягивается сама — по координатам города, без ключей и регистраций.

Источник: Open-Meteo. Два эндпоинта:
  archive  — реанализ ERA5, полная история, отстаёт от сегодня на ~5 дней;
  forecast — последние дни + прогноз вперёд, нужен для риска на сегодня и завтра.
Всё складывается в SQLite, поэтому повторные запуски не дёргают сеть заново.
"""
import datetime as dt

import pandas as pd
import requests

from . import db

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
HOURLY = "surface_pressure,temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation"
TIMEOUT = 90


def _coords() -> tuple[float, float, str]:
    return (
        float(db.get_setting("lat", "59.9386")),
        float(db.get_setting("lon", "30.3141")),
        db.get_setting("tz", "Europe/Moscow"),
    )


def _hourly_to_daily(hourly: dict, kind: str) -> list[dict]:
    df = pd.DataFrame(hourly)
    if df.empty:
        return []
    df["time"] = pd.to_datetime(df["time"])
    df["date"] = df["time"].dt.date
    agg = df.groupby("date").agg(
        p_mean=("surface_pressure", "mean"),
        p_min=("surface_pressure", "min"),
        p_max=("surface_pressure", "max"),
        t_mean=("temperature_2m", "mean"),
        t_min=("temperature_2m", "min"),
        t_max=("temperature_2m", "max"),
        rh_mean=("relative_humidity_2m", "mean"),
        wind_max=("wind_speed_10m", "max"),
        precip=("precipitation", "sum"),
    )
    # неполные сутки (текущий день по часам) оставляем: лучше приблизительно, чем никак
    out = []
    for date, row in agg.iterrows():
        rec = {"date": date.strftime("%Y-%m-%d"), "kind": kind}
        rec.update({k: (None if pd.isna(v) else round(float(v), 2)) for k, v in row.items()})
        out.append(rec)
    return out


def fetch_archive(date_from: str, date_to: str) -> int:
    lat, lon, tz = _coords()
    r = requests.get(ARCHIVE_URL, timeout=TIMEOUT, params={
        "latitude": lat, "longitude": lon, "start_date": date_from,
        "end_date": date_to, "hourly": HOURLY, "timezone": tz,
    })
    r.raise_for_status()
    rows = _hourly_to_daily(r.json().get("hourly", {}), "archive")
    return db.upsert_weather(rows)


def fetch_recent(past_days: int = 10, forecast_days: int = 3) -> int:
    """Свежие дни и прогноз — для экрана «Сегодня»."""
    lat, lon, tz = _coords()
    r = requests.get(FORECAST_URL, timeout=TIMEOUT, params={
        "latitude": lat, "longitude": lon, "hourly": HOURLY, "timezone": tz,
        "past_days": past_days, "forecast_days": forecast_days,
    })
    r.raise_for_status()
    rows = _hourly_to_daily(r.json().get("hourly", {}), "forecast")
    return db.upsert_weather(rows)


def sync(pad_days: int = 7) -> dict:
    """Догоняет погоду до полного покрытия дневника и до завтрашнего дня.

    Архив тянется только за недостающие куски, поэтому обычный запуск — быстрый.
    """
    e_from, e_to = db.entries_range()
    today = dt.date.today()
    if not e_from:
        e_from = (today - dt.timedelta(days=90)).strftime("%Y-%m-%d")

    need_from = (dt.date.fromisoformat(e_from) - dt.timedelta(days=pad_days)).strftime("%Y-%m-%d")
    archive_to = (today - dt.timedelta(days=6)).strftime("%Y-%m-%d")

    have_from, have_to = db.weather_range()
    fetched = 0
    if have_from is None:
        fetched += fetch_archive(need_from, archive_to)
    else:
        if need_from < have_from:
            fetched += fetch_archive(need_from, have_from)
        if have_to < archive_to:
            fetched += fetch_archive(have_to, archive_to)
    fetched += fetch_recent()

    w_from, w_to = db.weather_range()
    return {"fetched_days": fetched, "archive_from": w_from, "archive_to": w_to}


def as_frame() -> pd.DataFrame:
    with db.connect() as con:
        df = pd.read_sql_query("SELECT * FROM weather ORDER BY date", con)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    return df
