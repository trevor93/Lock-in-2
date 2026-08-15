#!/usr/bin/env python3
"""Scoped War Room agent bridge for Termux, Telegram relays, and CLI use."""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    sys.exit("Install the dependency with: pip install requests")

BASE = os.environ.get("WARROOM_URL", "").rstrip("/")
TOKEN_FILE = os.environ.get(
    "WARROOM_TOKEN_FILE",
    os.path.expanduser("~/.config/warroom/agent_token"),
)
TIMEOUT = (5, 30)

if not BASE:
    sys.exit("Set WARROOM_URL before running the bridge.")
try:
    with open(TOKEN_FILE, encoding="utf-8") as token_file:
        TOKEN = token_file.read().strip()
except OSError:
    sys.exit("WARROOM_TOKEN_FILE must point to a readable credential file.")
if not TOKEN:
    sys.exit("WARROOM_TOKEN_FILE contains no credential.")

parsed_base = urlparse(BASE)
if parsed_base.scheme != "https" or not parsed_base.netloc:
    sys.exit("WARROOM_URL must be an absolute HTTPS URL.")

HEADERS = {
    "X-Agent-Token": TOKEN,
    "Content-Type": "application/json",
}


def now_date():
    return datetime.now().strftime("%Y-%m-%d")


def now_time():
    return datetime.now().strftime("%H:%M")


def fail_for_status(response):
    status = response.status_code
    if status == 401:
        sys.exit("Agent credential rejected or expired (401).")
    if status == 403:
        sys.exit("Agent credential lacks the required scope (403).")
    if status == 429:
        retry = response.headers.get("Retry-After", "later")
        sys.exit(f"Agent request rate-limited (429); retry after {retry} seconds.")
    if status >= 500:
        sys.exit(f"War Room service unavailable ({status}); retry later.")
    if status >= 400:
        sys.exit(f"War Room request rejected ({status}).")


def read(path):
    response = requests.post(
        f"{BASE}{path}",
        headers=HEADERS,
        json={},
        timeout=TIMEOUT,
    )
    fail_for_status(response)
    return response.json()


def post(path, body):
    response = requests.post(
        f"{BASE}{path}",
        headers=HEADERS,
        json=body,
        timeout=TIMEOUT,
    )
    fail_for_status(response)
    return response.json()


def notify(title, message):
    try:
        subprocess.run(
            [
                "termux-notification",
                "--title",
                title,
                "--content",
                message,
                "--priority",
                "max",
                "--sound",
            ],
            timeout=10,
            check=False,
        )
        subprocess.run(
            ["termux-vibrate", "-d", "800"],
            timeout=5,
            check=False,
        )
    except FileNotFoundError:
        pass

    telegram_token = os.environ.get("TG_BOT_TOKEN")
    telegram_chat = os.environ.get("TG_CHAT_ID")
    if telegram_token and telegram_chat:
        try:
            requests.post(
                f"https://api.telegram.org/bot{telegram_token}/sendMessage",
                json={"chat_id": telegram_chat, "text": f"⚔ {title}\n{message}"},
                timeout=TIMEOUT,
            )
        except requests.RequestException:
            pass
    print(f"[{now_time()}] {title} — {message}")


def cmd_briefing(_args):
    data = read("/api/agent/v1/briefing")
    print(data["briefing"])
    if data.get("current"):
        current = data["current"]
        print(
            f"\n>>> CURRENT BLOCK: {current['title']} "
            f"({current['start_time']}-{current['end_time']})"
        )


def cmd_pending(_args):
    print(json.dumps(read("/api/agent/v1/pending"), indent=2))


def cmd_watch(_args):
    print("HERMES WATCH ACTIVE.")
    alerted = set()
    last_block = None
    while True:
        try:
            data = read("/api/agent/v1/pending")
            current = data.get("current_block")
            if current and current["id"] != last_block:
                last_block = current["id"]
                notify(
                    f"NOW: {current['title']}",
                    f"{current['start']}–{current['end']}.",
                )
            for block in data.get("overdue_unlogged", []):
                key = f"{now_date()}-{block['id']}"
                if key not in alerted:
                    alerted.add(key)
                    notify(
                        "UNLOGGED BLOCK",
                        f"'{block['title']}' ended {block['end']} with no report.",
                    )
            for flag in data.get("unacknowledged_flags", []):
                key = f"flag-{flag['id']}"
                if key not in alerted:
                    alerted.add(key)
                    notify(
                        f"HONESTY FLAG [{flag['severity']}]",
                        flag["message"][:200],
                    )
            hour = int(now_time()[:2])
            debrief_key = f"debrief-{now_date()}"
            if (
                hour >= 21
                and not data.get("debrief_filed_today")
                and debrief_key not in alerted
            ):
                alerted.add(debrief_key)
                notify("NIGHT DEBRIEF MISSING", "File the intelligence report.")
        except requests.RequestException as error:
            print(f"[watch] network error: {error.__class__.__name__}")
        time.sleep(max(30, int(os.environ.get("WATCH_INTERVAL", "60"))))


def cmd_done(args):
    post(
        "/api/agent/v1/block-log",
        {
            "block_id": int(args.block_id),
            "date": now_date(),
            "status": args.status,
            "note": args.note,
        },
    )
    print(f"Block {args.block_id} -> {args.status}")


def cmd_intel(args):
    response = post(
        "/api/agent/v1/intel",
        {
            "title": args.title,
            "domain": args.domain,
            "situation": args.situation,
            "my_move": args.move,
            "outcome": args.outcome,
            "verdict": args.verdict,
            "people": args.people,
            "log_date": now_date(),
        },
    )
    print(f"Intel filed (id {response['id']}).")


def cmd_journal(args):
    post(
        "/api/agent/v1/debrief",
        {
            "date": now_date(),
            "wins": args.wins,
            "breaks": args.breaks,
            "tomorrow_targets": args.targets,
            "strategy_insight": args.insight,
            "sleep_hours": args.sleep_hours,
            "mood": args.mood,
            "energy": args.energy,
        },
    )
    print("Debrief updated.")


def cmd_say(args):
    post(
        "/api/agent/v1/message",
        {"content": args.message, "role": args.role},
    )
    print("Posted to the Council log.")


def cmd_export(args):
    if not args.authorize_full_export:
        sys.exit(
            "Refusing full export. Re-run with --authorize-full-export and "
            "a credential explicitly carrying export:read."
        )
    print(json.dumps(read("/api/agent/v1/export"), indent=2))


parser = argparse.ArgumentParser(description="Hermes Bridge — War Room connector")
commands = parser.add_subparsers(dest="cmd", required=True)
commands.add_parser("briefing").set_defaults(fn=cmd_briefing)
commands.add_parser("pending").set_defaults(fn=cmd_pending)
commands.add_parser("watch").set_defaults(fn=cmd_watch)

done = commands.add_parser("done")
done.add_argument("block_id")
done.add_argument("--status", default="done")
done.add_argument("--note", default=None)
done.set_defaults(fn=cmd_done)

intel = commands.add_parser("intel")
intel.add_argument("title")
intel.add_argument("-d", "--domain", default="other")
intel.add_argument("-s", "--situation", default=None)
intel.add_argument("-m", "--move", default=None)
intel.add_argument("-o", "--outcome", default=None)
intel.add_argument("-v", "--verdict", default="pending")
intel.add_argument("-p", "--people", default=None)
intel.set_defaults(fn=cmd_intel)

journal = commands.add_parser("journal")
journal.add_argument("--wins")
journal.add_argument("--breaks")
journal.add_argument("--targets")
journal.add_argument("--insight")
journal.add_argument("--sleep-hours", type=float, dest="sleep_hours")
journal.add_argument("--mood", type=int)
journal.add_argument("--energy", type=int)
journal.set_defaults(fn=cmd_journal)

say = commands.add_parser("say")
say.add_argument("message")
say.add_argument("--role", default="assistant")
say.set_defaults(fn=cmd_say)

export = commands.add_parser("export")
export.add_argument("--authorize-full-export", action="store_true")
export.set_defaults(fn=cmd_export)

arguments = parser.parse_args()
try:
    arguments.fn(arguments)
except requests.RequestException as error:
    sys.exit(f"Network request failed: {error.__class__.__name__}")
except (ValueError, KeyError, json.JSONDecodeError):
    sys.exit("War Room returned an invalid response.")
