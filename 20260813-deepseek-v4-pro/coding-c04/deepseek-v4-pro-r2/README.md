# Giraffe Driving a Tiny Car — Animated SVG

Artifact: `giraffe-tiny-car.svg` (800 × 500, SMIL animation, no JavaScript or external assets).

What moves:

- Sun rays rotate; two clouds and birds drift across the sky
- The tiny red car bounces gently while the road dashes scroll
- Both wheels spin (speed is matched to the scrolling road)
- The giraffe's neck/body sways, its head nods and its eye blinks
- The tail swishes, the steering wheel wiggles, and exhaust puffs stream out

## Run

- Easiest: double-click `giraffe-tiny-car.svg`, or drag it into Chrome / Firefox / Safari / Edge.
- From a terminal:

  ```bash
  python3 -m http.server 8000 --directory /tmp/dsh-test-c04
  ```

  then open <http://localhost:8000/giraffe-tiny-car.svg>.
- To embed in an HTML page, use `<img src="giraffe-tiny-car.svg" ...>` or an `<object>` tag.

## Test

Automated structural checks (Python 3 standard library only):

```bash
python3 test_svg.py
```

It verifies XML well-formedness, essential art, that every animation loops, and that
wheel spin speed is physically consistent with the scrolling road.

Manual visual checklist (open in a browser):

1. Sun rays rotate slowly; clouds and birds move across the sky.
2. The car bounces and both wheels rotate continuously.
3. Road dashes stream right-to-left under the car (the car is driving to the right).
4. The giraffe neck sways, head bobs, and the eye blinks every ~4.5 s.
5. Tail swishes, steering wheel/horn wiggles, and exhaust puffs pulse.

Expected result: all animations run indefinitely and stay smooth; there are no console
errors, and the SVG scales cleanly because it is vector-based.
