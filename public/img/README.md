# public/img

The site's own artwork. Anything here is served from `/img/…`.

`logo-light.png` is the mark in the top bar, shown 50 px tall. It arrived with
its background already transparent and is used exactly as it was given — no
cutting, no resizing. If it ever fails to load, the bar falls back to a plain
pin.

Two earlier marks are kept in case either is wanted back; switching is a change
of `src` in the five pages. `logo.png` is the same pale drawing without the
flag, cut from a white ground here. `logo-dark.png` is the first version, in
deeper colours, cut from a black one.

The same file is the browser-tab icon. Cut-down square icons were tried and
dropped: they had to sit on an opaque ground, which showed as a black box
behind the mark in a Chrome or Edge tab. Pointing the tab straight at the mark
keeps its transparency, and costs nothing — the browser has already fetched it
for the bar.

On an iOS home screen the transparent parts fill with black, which is how iOS
treats any transparent icon.
