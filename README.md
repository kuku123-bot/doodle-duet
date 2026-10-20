# Doodle Duet 🎨💞

A two-person, real-time drawing app for Mac, iPad and phones. Draw on the same canvas at the same time, help each
other, play drawing games and learn to draw together. No accounts, no server of our own: just open the page.

## What it does

- **Live together**: every stroke streams to your partner while you draw it (direct WebRTC link, a few ms on the same
  Wi-Fi). You see your partner's pointer, laser pointer (Point tool) and reactions.
- **Pro tools, simple UI**: 11 brushes (ink pen, pencil, marker, soft brush, watercolor, crayon, calligraphy, airbrush,
  spray, highlighter, neon) + 2 erasers, Apple Pencil pressure, smoothing, symmetry, fill bucket, shapes (line, arrow,
  box, circle, triangle, star, heart, filled or not), hold-at-the-end-of-a-stroke to snap a straight line or circle,
  text, colour picker + palette + eyedropper, layers (opacity, order, hide, rename), paper colours, grid / thirds / face
  guides, zoom / pan / rotate, undo / redo for each person, export PNG, gallery, time-lapse video.
- **Modes**: Free draw · Split canvas (drag the divider anywhere, overlap margin, “stay on my side” or draw anywhere,
  mirror ghost of the other half) · Mirror magic (symmetry for both) · Teach & trace · Take turns · Fold-a-friend ·
  Draw-off (same prompt, hidden until time is up) · Guess it.
- **Ideas**: picture rails on the left and right (56 original drawings incl. 7 step-by-step lessons, 145 emoji, your own
  photos). Open one as a floating card, trace it faintly under the drawing (whole page, a half, or your side), pick its
  colours, or send it to your partner's screen.

## Using it

1. Open the app, type your name.
2. Tap **Invite** → **Send invite** / **Copy link**, and send the link to your partner.
3. They open the link and you are drawing together. Opening the same link later reconnects you to the same room,
   whoever opens it first.

iPad / iPhone: Share → **Add to Home Screen** for full-screen drawing. Once an Apple Pencil touches the screen,
fingers only move the canvas (palm rejection); two fingers pinch / rotate, a two-finger tap undoes.

## How it connects

- Matchmaking uses the free public PeerJS server; the drawing itself goes **directly** between the two devices.
- Networks that block direct links (strict / carrier-grade NAT) fall back automatically to an **encrypted relay**
  through public MQTT brokers (AES-GCM; the brokers only ever see scrambled bytes; lost packets are re-sent). The
  secret key for it is inside the invite link, so the link connects even where the typed room code alone would not.
- The drawing is a list of operations with Lamport ordering, merged symmetrically; both devices keep a full copy in
  IndexedDB, and after any disconnect they swap what is missing. Drawings never leave your devices otherwise.

## Development

```
npm install          # only Playwright, for the tests
npm run serve        # http://localhost:8377
npm test             # relay repair unit test + touch/pen test + two-browser test (Chromium ↔ WebKit)
npm run test:relay   # the two-browser test forced through the encrypted relay
```

Plain ES modules, no build step: the folder can be hosted as-is on any static host (GitHub Pages, Netlify…).
`tools/shots.mjs` and `tools/artsheet.mjs` make screenshots for a visual check; `tools/icons.mjs` redraws the icons.
