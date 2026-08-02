# Terminal fonts

The terminal presentation packages the same font set as Twee's native image
renderer so browser playback has deterministic glyph metrics and symbol
fallbacks:

- JetBrains Mono Regular
- Noto Sans Mono Regular
- Noto Sans Symbols Regular
- Noto Sans Symbols 2 Regular

The files were copied from Twee's `internal/render/fonts` package. The
adjacent license files contain the applicable SIL Open Font License notices.
The family names used by Record Player are package-specific, so the font-face
rules do not change fonts elsewhere in a host application.
