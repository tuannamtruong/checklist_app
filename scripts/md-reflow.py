#!/usr/bin/env python3
"""Hard-wrap Markdown prose at a fixed width, leaving everything else alone.

    python3 scripts/md-reflow.py docs/*.md prototype/README.md
    python3 scripts/md-reflow.py --check docs/*.md     # exit 1 if anything would change

The house style is 120 columns for prose. Tables and code blocks are never
touched: a wrapped table row stops being a table, and a wrapped code line stops
being the code it documents. Both are allowed to run past the limit.

Stdlib only, so it runs anywhere python3 does — same rule as install/serve.py.
"""

import argparse
import re
import sys
import textwrap
from pathlib import Path

FENCE = re.compile(r"^\s{0,3}(```|~~~)")
TABLE = re.compile(r"^\s*\|")
HEADING = re.compile(r"^\s{0,3}#{1,6}\s")
# Thematic break or a setext underline. Either way, joining it to its
# neighbour would change what the line means.
RULE = re.compile(r"^\s{0,3}([-*_]\s*){3,}$|^\s{0,3}(=+|-+)\s*$")
QUOTE = re.compile(r"^\s{0,3}>")
HTML = re.compile(r"^\s{0,3}<")
LIST = re.compile(r"^(\s*)([-*+]|\d+[.)])(\s+)(.*)$")
# Two trailing spaces or a backslash is an explicit line break the author asked
# for. It ends the unit being wrapped rather than being folded away.
HARD_BREAK = re.compile(r"(  |\\)$")


def is_verbatim(line):
    """Lines that carry meaning in their layout and must survive untouched."""
    return (
        not line.strip()
        or TABLE.match(line)
        or HEADING.match(line)
        or RULE.match(line)
        or QUOTE.match(line)
        or HTML.match(line)
        or line.startswith("    ")  # indented code block
    )


def wrap(text, width, indent, hanging):
    return textwrap.wrap(
        text,
        width=width,
        initial_indent=indent,
        subsequent_indent=hanging,
        break_long_words=False,  # never split a URL or a long identifier
        break_on_hyphens=False,  # `write-then-rename` stays one word
    ) or [indent.rstrip()]


def reflow(src, width=120):
    out = []
    lines = src.split("\n")
    i = 0
    in_fence = False
    fence_marker = None

    while i < len(lines):
        line = lines[i]

        if in_fence:
            out.append(line)
            if FENCE.match(line) and line.strip().startswith(fence_marker):
                in_fence = False
            i += 1
            continue

        fence = FENCE.match(line)
        if fence:
            in_fence = True
            fence_marker = fence.group(1)
            out.append(line)
            i += 1
            continue

        if is_verbatim(line):
            out.append(line)
            i += 1
            continue

        # A prose unit: this line plus every plain continuation line under it.
        # A list marker starts a new unit, so two adjacent bullets never merge.
        item = LIST.match(line)
        if item:
            lead, marker, gap, rest = item.groups()
            indent = f"{lead}{marker}{gap}"
            hanging = " " * len(indent)
            parts = [rest]
        else:
            indent = hanging = re.match(r"\s*", line).group(0)
            parts = [line.strip()]

        broke = bool(HARD_BREAK.search(line))
        i += 1
        while not broke and i < len(lines):
            nxt = lines[i]
            if is_verbatim(nxt) or FENCE.match(nxt) or LIST.match(nxt):
                break
            parts.append(nxt.strip())
            broke = bool(HARD_BREAK.search(nxt))
            i += 1

        text = " ".join(p for p in parts if p)
        trailer = ""
        if broke:
            # Preserve the author's explicit break, and re-wrap what precedes it.
            trailer = HARD_BREAK.search(text).group(0)
            text = HARD_BREAK.sub("", text).rstrip()

        wrapped = wrap(text, width, indent, hanging)
        wrapped[-1] += trailer
        out.extend(wrapped)

    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--width", type=int, default=120)
    ap.add_argument(
        "--check",
        action="store_true",
        help="report files that would change and exit 1, writing nothing",
    )
    args = ap.parse_args()

    stale = []
    for path in args.paths:
        src = path.read_text(encoding="utf-8")
        out = reflow(src, args.width)
        if out == src:
            continue
        stale.append(path)
        if not args.check:
            path.write_text(out, encoding="utf-8")
            print(f"reflowed {path}")

    if args.check and stale:
        for path in stale:
            print(f"needs reflow: {path}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
