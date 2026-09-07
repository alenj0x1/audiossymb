# Contributing

The codebase, its comments and the README are written in Spanish. **Git history, issues and
pull requests are written in English.** Code identifiers stay in English too.

## Commit convention

audiossymb follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

| Type | Use it for |
| --- | --- |
| `feat` | A new capability the user can notice |
| `fix` | A bug fix |
| `perf` | A change made for speed or memory, with no behaviour change |
| `refactor` | Restructuring that changes neither behaviour nor performance |
| `style` | Visual design and CSS with no functional change |
| `docs` | README, this file, code comments |
| `test` | Tests only |
| `build` | Build setup, dependencies, Vite config |
| `chore` | Repository housekeeping: ignore rules, licence, metadata |
| `revert` | Reverts a previous commit |

### Scope

The area of the project the change lands in. Use the directory or module name:

`audio`, `features`, `timeline`, `engine`, `visual`, `renderer`, `vibe`, `palette`,
`environment`, `grade`, `layers`, `hero`, `nebula`, `flow`, `particles`, `rings`, `spotify`,
`auth`, `ui`, `hud`, `repo`, `deps`.

Use a single scope. Omit it only when the change is genuinely global.

### Subject

- English, imperative mood: `add`, `fix`, `remove` — not `added`, `fixes`, `removing`.
- Lower case, no trailing period.
- 72 characters or fewer.
- Describe the **outcome**, not the file you touched.

```
feat(hero): add physically based sculpture lit by a procedural HDR studio
fix(audio): stop the synthetic pulse from replacing a silent live source
perf(hero): halve icosphere subdivision to keep the vertex displacement cheap
style(ui): replace gradient fills with tinted glass on player controls
docs(readme): document the three routes to real Spotify audio
chore(repo): add MIT licence and package metadata
```

Avoid:

```
fix: bug              (which bug?)
feat: update renderer (what does it do now?)
Fixed the audio.      (past tense, capitalised, period)
```

### Body

Optional for trivial commits, expected for anything else. Wrap at 80 columns and answer:

1. **What was wrong or missing**, in terms of observable behaviour.
2. **Why this approach**, especially when a simpler one was tried and failed.

Explaining the *why* matters more than the *what* — the diff already shows the what. When a
fix is subtle, name the mechanism:

```
fix(audio): stop the synthetic pulse from replacing a silent live source

While capturing system audio the visuals kept pulsing on a fixed pattern and
carried on even with the music paused. The feature extractor reports
`active: false` after ~90 silent frames, and the render loop treated that as
"no source" and fell back to the time-driven ambient pulse.

The fallback is now reserved for the case where no source is attached at all.
With a live source the scene rests on the real, decaying values, so a pause
looks like a pause.

Chrome also hands back silence from a MediaStreamAudioSourceNode when the
stream's sample rate differs from the AudioContext's, with no error raised, so
the context is now rebuilt at the stream's rate.
```

### Footer

- `BREAKING CHANGE: <description>` for anything that invalidates stored settings, saved vibes
  or the Spotify redirect URI.
- `Closes #12`, `Refs #34` to link issues.
- Co-authorship trailers when applicable.

## Branches

`main` is the released branch. Work on `<type>/<short-subject>`, in English:

```
feat/kinetic-typography
fix/capture-silence
docs/commit-convention
```

## Pull requests

- Title follows the commit convention: `fix(audio): stop the synthetic pulse …`
- Description states what changed, why, and **how it was verified**. Say plainly when
  something could not be verified and why.
- Attach a screenshot or a short capture for any visual change.
- `npm run build` must pass.

## Before committing

```bash
npm run build
```

There is no test suite yet. Visual changes are verified by running the app (`npm run dev`) and
checking the browser console for shader compilation errors — three.js reports those as
`THREE.WebGLProgram: Shader Error`, and a broken layer often renders as nothing at all rather
than throwing.
