#!/usr/bin/env python3
"""Small dependency-free checks for giraffe-tiny-car.svg.

Validates XML well-formedness, required drawing parts, animation count, and a
physical-consistency check: the moving road dashes and the spinning wheels
should imply the same ground speed.
"""
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "giraffe-tiny-car.svg")
NS = {"s": "http://www.w3.org/2000/svg"}


def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)


def main():
    try:
        tree = ET.parse(SVG)
    except ET.ParseError as exc:
        fail(f"not well-formed XML: {exc}")

    root = tree.getroot()
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        fail("root element is not <svg>")
    if root.get("viewBox") != "0 0 800 500":
        fail("unexpected viewBox")

    raw = open(SVG, encoding="utf-8").read()

    # Essential art is present (colour/style probes).
    for needle in ("#ef5145", "#f6c14f", "#2c3038", "#8bcb6f", "#bfeaff",
                   "A giraffe driving a tiny car"):
        if needle not in raw:
            fail(f"missing expected content: {needle!r}")

    anims = root.findall(".//s:animate", NS) + root.findall(".//s:animateTransform", NS)
    if len(anims) < 15:
        fail(f"too few animation elements: {len(anims)}")
    for anim in anims:
        if anim.get("dur") is None:
            fail("animation element without dur")
        if anim.get("repeatCount") != "indefinite":
            fail(f"animation element {anim} is not set to loop indefinitely")
        if anim.tag == "{http://www.w3.org/2000/svg}animateTransform":
            if anim.get("type") not in {"rotate", "translate", "scale"}:
                fail(f"unsupported transform type: {anim.get('type')}")

    # Ground-speed consistency: dashes move one full pattern (50+30 px) in 0.637 s;
    # a wheel of r=24 spinning once per 1.2 s should have the same tangential speed.
    m = re.search(r'stroke-dasharray="(?P<dash>\d+) (?P<gap>\d+)"', raw)
    dash_dur = float(re.search(r'<animate attributeName="stroke-dashoffset"[^>]*dur="(?P<d>[\d.]+)s"', raw).group("d"))
    wheel_dur = float(re.search(r'type="rotate" from="0 302 402"[^>]*dur="(?P<d>[\d.]+)s"', raw).group("d"))
    wheel_r = float(re.search(r'<circle cx="302" cy="402" r="(?P<r>[\d.]+)"', raw).group("r"))
    road_speed = (float(m.group("dash")) + float(m.group("gap"))) / dash_dur
    wheel_speed = 2.0 * math.pi * wheel_r / wheel_dur
    if abs(road_speed - wheel_speed) / road_speed > 0.02:
        fail(f"road/wheel speeds differ: road={road_speed:.2f}px/s wheel={wheel_speed:.2f}px/s")

    print(f"PASS: {SVG} is well-formed SVG")
    print(f"PASS: {len(anims)} looping animation elements found")
    print(f"PASS: road dash speed {road_speed:.2f} px/s matches wheel speed {wheel_speed:.2f} px/s")
    print("Manual browser check: open the SVG and confirm sun rays, clouds, bounce, wheel spin,")
    print("neck sway, eye blink, exhaust puffs and steering wiggle all animate smoothly.")


if __name__ == "__main__":
    main()
