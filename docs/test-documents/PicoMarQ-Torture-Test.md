---
title: "PicoMarQ torture test"
author: 'Ruth Example'
note: Front matter stays exactly as typed -- quotes, hyphens, and "..." included.
---

# PicoMarQ Torture Test -- "Dumb" Typography Edition

This file uses *straight* quotes, double hyphens, and three-period ellipses everywhere, on purpose. Open it, look at how everything renders, then choose **Edit > Apply Smart Typography** and watch the "dumb" marks turn into real ones. Ctrl+Z should put every one of them back in a single step.

Ruth's rule of thumb: if it looks fine here, it'll look fine in a 200-page draft... probably.

## Heading 2 -- Blocks of Text

The sociological imagination, C. Wright Mills wrote, lets us grasp "history and biography and the relations between the two within society." That's the whole job in one sentence -- the rest is footnotes. A paragraph like this one tests ordinary body text: it wraps, it has 'single' and "double" quotes, it has a dash -- like that -- and it trails off...

Here's a second paragraph with some **bold text**, some *italic text*, and some ***bold italic text***. Markdown also allows __bold with underscores__, _italics with underscores_, and ___both___. Mixing them inside a sentence -- **bold, then *italic inside bold*, then back** -- should hold together. There's ~~strikethrough~~ too, and `inline code "stays straight"` no matter what the button does.

A sentence with a hard line break at the end of this line  
should continue on the next line without starting a new paragraph.

### Heading 3 -- Quotes in Awkward Places

Apostrophes and quotes that trip up "smart" conversion:

- The '90s, rock 'n' roll, and 'tis the season (the opening-quote cases)
- Ruth's book, the students' essays, Durkheim's "Suicide" (the apostrophe cases)
- A quote inside a quote: "She said 'no,' and that was that."
- A quote after a dash -- "like this one" -- and after a parenthesis ("like this")
- Height and distance written with primes: 5'10" and 12" of rain
- Nested punctuation: ("quoted (and parenthesized)")... done.

#### Heading 4 -- Italic, Regular Weight, Between Heading 3 and Body

This heading should look smaller than Heading 3 above it, larger than this paragraph, italic, and not bold. If it looks like Heading 3, the style didn't take.

## Blockquotes

> "Society is not a mere sum of individuals. Rather, the system formed by their association represents a specific reality which has its own characteristics."
>
> -- Emile Durkheim, *The Rules of Sociological Method* (1895)

> Goffman's point was simpler: "All the world is not, of course, a stage, but the crucial ways in which it isn't are not easy to specify."
>
> > A nested quote, with "quotes" of its own -- and a trailing ellipsis...

## Lists

### A numbered list

1. Read the "methods" section first -- always.
2. Check the sample. Who's missing?
3. Look for the table that doesn't match the text...
4. Then, and only then, read the conclusion.
   1. A nested numbered item with 'quotes'
   2. Another one -- with a dash

### A numbered list that starts at five

5. Fifth
6. Sixth
7. Seventh ("the one everyone skips")

### A bulleted list

- Structure: "the rules of the game"
- Agency: what people do with them -- or against them
- Culture
  - Norms (the 'shoulds')
  - Values (the 'whys')
    - A third level, just to be difficult...
- Institutions

### A task list

- [x] Headings 1 through 4
- [x] Bold, italic, bold italic
- [ ] Run Edit > Apply Smart Typography
- [ ] Press Ctrl+Z and confirm everything comes back

## A Table

The separator row below uses `---` and `:--`, which must survive the button untouched. The cells contain "dumb" marks that should convert.

| Thinker | Key work | Catchphrase | Year |
|:--------|:--------:|-------------|-----:|
| Durkheim | *Suicide* | "Social facts" -- treat them as things | 1897 |
| Weber | *The Protestant Ethic* | The 'iron cage'... | 1905 |
| Goffman | *Presentation of Self* | **Front stage** vs. back stage | 1956 |
| Mills | *The Sociological Imagination* | ***Private troubles, public issues*** | 1959 |

## Links and Images

A plain hyperlink: [Project Gutenberg](https://www.gutenberg.org/). A link whose address contains two hyphens and whose title is in quotes -- both must stay untouched: [a link with a title](https://example.com/some--path "The link's title"). A bare address: <https://www.jacksonville.gov/>.

An image embedded inside the file (a data URL), so it works offline:

![Embedded image](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0ODAiIGhlaWdodD0iMTIwIiB2aWV3Qm94PSIwIDAgNDgwIDEyMCI+PHJlY3QgeD0iMiIgeT0iMiIgd2lkdGg9IjQ3NiIgaGVpZ2h0PSIxMTYiIHJ4PSIxNCIgZmlsbD0iI2VlZjNlYyIgc3Ryb2tlPSIjMmY1ZDNhIiBzdHJva2Utd2lkdGg9IjMiLz48dGV4dCB4PSIyNDAiIHk9IjU0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0iR2VvcmdpYSwgc2VyaWYiIGZvbnQtc2l6ZT0iMjYiIGZpbGw9IiMyZjVkM2EiPkVtYmVkZGVkIGltYWdlIChkYXRhIFVSTCk8L3RleHQ+PHRleHQgeD0iMjQwIiB5PSI4OCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2IiBmaWxsPSIjMmY1ZDNhIj5TdG9yZWQgaW5zaWRlIHRoZSBNYXJrZG93biBmaWxlIGl0c2VsZi48L3RleHQ+PC9zdmc+)

An image from the folder next to this file (keep `picomarq-test-image.svg` beside the .md):

![Relative image](picomarq-test-image.svg)

An image from the internet (the upstream Scratch editor's screenshot; needs a connection):

![Scratch screenshot](https://raw.githubusercontent.com/erictli/scratch/main/docs/screenshot.png)

## Things the Button Must Leave Alone

Inline code with "quotes" and -- dashes: `git commit -m "fix: don't -- ever..."`. Dollar signs are ordinary text, so this still converts: $5 an hour and 'overtime' at $10 -- "allegedly". And a block of code:

```
This fenced block is quoted "verbatim" -- nothing in here changes...
After you run Edit > Apply Smart Typography, the body text above should contain:
  “ ” curly double quotes      ‘ ’ curly single quotes
  — an em dash                 … an ellipsis
and this block, the inline code, the math, the table separators,
the link addresses, and the front matter should be byte-for-byte the same.
```

Block math, also untouched:

$$
y' = \frac{dy}{dx} \quad \text{("the derivative")}
$$

A horizontal rule follows -- three hyphens on their own line, which must not become an em dash:

---

## Odds and Ends

Special characters that are not quotes: the degree sign 20°C, the ampersand &, the percent 50%, copyright (c), a URL in the middle of a sentence https://www.gutenberg.org/ and an email like ruth.example@example.edu.

Trailing matter: one final "quoted" word -- and an ellipsis to finish...

## Known Limits of the Formatted View

These render, but they do **not** survive a save from the formatted view (the source view keeps them). Smart typography leaves them alone either way.

An HTML comment, invisible here but visible in the source view: <!-- don't "touch" this -- please... -->

Escaped characters that should show the symbols themselves: \*not italic\*, \_not italic\_, \# not a heading, and a literal backslash \\.
