# Bundled fonts

Both are self-hosted so the site loads no third-party resources.

## XB Niloofar — Persian

`xb-niloofar-regular.woff2`, `xb-niloofar-bold.woff2`

SIL Open Font License 1.1. Converted from the TrueType originals and subset to
Latin-1, the Arabic blocks, the Arabic presentation forms, and U+200C — the
zero-width non-joiner, without which Persian is unreadable. Shaping tables
(GSUB, GPOS, GDEF) are kept; only Apple's AAT tables are dropped, which browsers
do not use. 1.25 MB each became about 60 KB.

## EB Garamond — Latin

`eb-garamond-latin.woff2`, `eb-garamond-latin-ext.woff2`, and the two italics.

SIL Open Font License 1.1, from Google Fonts. These are variable fonts covering
weights 400 to 800 in one file, so there is no separate bold to download.
`latin-ext` is loaded only when a page actually uses a character from it.

To change either font, replace the files here and update the `@font-face` rules
at the top of `public/css/style.css`.
