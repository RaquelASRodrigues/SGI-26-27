# Week 5 findings

Analysis used the extracted corpus in `data/marvel_pages/`, not a ZIP. It contains 304 `.txt` files: 303 map one-to-one to Week 1 node IDs after URL-decoding the filename `Mark_Hazzard%3A_Merc`; the extra file is `README.txt`. All 303 graph pages were available. No scraping was done.

## Environment

NetworkX 3.6.1 (`louvain_communities`) and Matplotlib 3.11.1 are available. spaCy 3.8.16 was installed with the announced command `python -m pip install spacy` to use its English stopword set for M3; `en_core_web_sm`, NLTK, and scikit-learn are absent. No other packages were installed.

## Corpus and preprocessing

For cross-language reproducibility, this analysis uses a Unicode-letter tokenizer rather than the earlier proposed spaCy tokenizer: maximal runs of Unicode letters, allowing internal straight or curly apostrophes, lowercased; punctuation and numeric-only tokens are dropped; stopwords are retained unless explicitly removed for the M3 comparison. Hyphenated forms split at the hyphen. Python and JavaScript forms:

```python
import unicodedata

def tokenize(text):
    tokens, current, i = [], [], 0
    while i < len(text):
        ch = text[i]
        if unicodedata.category(ch).startswith("L"):
            current.append(ch)
            i += 1
        elif ch in "'’" and current and i + 1 < len(text) \
                and unicodedata.category(text[i + 1]).startswith("L"):
            current.append(ch)
            i += 1
        else:
            if current:
                tokens.append("".join(current).lower())
                current = []
            i += 1
    if current:
        tokens.append("".join(current).lower())
    return tokens
```

```js
function tokenize(text) {
  return (text.match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? [])
    .map(token => token.toLowerCase());
}
```

The Python scanner and JS Unicode-property regex were checked for parity over the corpus; both give the counts below. This small change from the prior spaCy proposal makes the rule independently reproducible in the browser. The M3 stopword set is spaCy 3.8.16 English `STOP_WORDS`; for identical JS stopword removal, export that set as JSON and filter with `!stopWords.has(token)`. No `en_core_web_sm` model is used.

| Measure | Result |
| --- | ---: |
| Pages mapped to nodes | 303 |
| Total characters | 4,447,666 (mean 14,678.8) |
| Characters, min / median / max | 1,244 / 7,642 / 87,256 |
| Tokens, total / mean | 727,258 / 2,400.2 |
| Tokens, min / median / max | 194 / 1,238 / 14,167 |
| Total tokens / types / hapaxes | 727,258 / 27,013 / 9,651 |
| Hapax share | 35.73% |

Compared with the course-page reference (about 727k tokens, 27k types, 36% hapaxes), differences are negligible: +258 tokens, +13 types, and −0.27 percentage points in hapax share. No large discrepancy needs explaining for this tokenizer.

Three inspected page openings:

- **Famous — Spider-Man:** 63,490 characters, 10,292 tokens. The opening identifies the character as a Marvel superhero and names Stan Lee, Steve Ditko, and *Amazing Fantasy* #15.
- **Minor — Black Jack Tarr:** 2,755 characters, 460 tokens. The opening describes him as an aide to Sir Denis Nayland Smith.
- **Shortest — Helix (Marvel Comics):** 1,244 characters, 194 tokens. The opening identifies Helix as Rafael Carago and mentions his New Warriors appearance.

The prose has no detected raw HTML tags, wiki-link brackets, infobox/template markup, bullet-list prefixes, control characters, or U+FFFD replacement characters. Instead, section labels are plain-text lines: `References` appears in 302 pages, `External links` in 263, `Publication history` in 260, `Fictional character biography` in 281, and `Powers and abilities` in 260. Bibliographies, publication listings, and these repeated sections are text, not markup, and were retained in every analysis. Typographic punctuation and symbols occur, including dashes and a few currency/fraction symbols.

On each page, the full node display label appears literally in 161/303 pages; after removing a trailing parenthetical disambiguator, the base label appears in 303/303. This does not capture every alias: for edge mention checks, the target display label, its disambiguation-stripped form, and the URL-title form were searched with case-insensitive word boundaries. **1,574/1,784 edges (88.23%)** had such a target-name match in the source page. This is a literal name/title proxy, not proof that the link text or mention refers unambiguously to that node.

## M2 — shared n-grams and copy network

For each n, each page contributes a set of distinct n-token shingles. An inverted index maps each shingle to its pages; unordered page pairs sharing one or more shingles become weighted edges, where weight is the number of distinct shared shingles. “Clusters” below are connected components of this page-pair network, including isolated pages.

| Shingle size | Page pairs / copy-network edges | Components | Largest component sizes |
| ---: | ---: | ---: | --- |
| 6 | 43,322 | 1 | 303 |
| 8 | 40,570 | 2 | 302, 1 |
| 12 | 8,172 | 16 | 287, 2, then 14 singletons |

At 8 tokens, Solomon Kane is the isolated page; the other 302 pages connect through at least one shared shingle. A connected component is not a “copied-pages cluster” in the strong sense: ubiquitous lead templates and short bridges connect otherwise unrelated pages. For example, the exact 8-gram `in american comic books published by marvel comics` occurs in **282/303** pages; `appearing in american comic books published by marvel` occurs in 281.

The largest 8-gram edge weights include Eddie Brock–Venom (510 shared shingles), Cyclops–Jean Grey (470), Ghost Rider–Ghost Rider (Johnny Blaze) (217), Spitfire–Union Jack (200), and Mayday Parker–Spider-Woman (192). I inspected the raw pages behind the largest edges:

| Pair / evidence | Reading of the shared raw passage |
| --- | --- |
| Eddie Brock ↔ Venom — 510 shared 8-grams; longest identical run 57 tokens. Brief excerpt: “Roger Stern later asked him if he could use the idea for Spider-Man's alien costume.” | Shared narrative/editorial history about the symbiote costume; this is substantive repeated prose, not a generic article opening. The pair are closely related identities, so the overlap is unsurprising but real. |
| Cyclops ↔ Jean Grey — 470; longest run 102 tokens. Excerpt begins: “Cyclops leaves his wife and child behind to lead the reunited original X-Men…” | A long X-Factor plot/editorial paragraph appears in both pages. This is strong evidence of duplicated narrative text across related entries. |
| Spider-Woman ↔ Spider-Woman (Jessica Drew) — 177; longest run 129 tokens. | A creator’s explanation of the Spider-Woman name is repeated in both entries; shared editorial history, not unrelated coincidence. |
| Spitfire ↔ Union Jack — 200; longest run 58 tokens. Excerpt includes a shared *New Invaders: To End All Wars* collected-edition listing. | Bibliographic/list boilerplate, not plot prose. Several other high-weight Union Jack/Spitfire links are similarly trade-paperback or publication-history listings. |
| Mayday Parker ↔ Spider-Woman — 192; longest run 166 tokens. | The overlap is narrative prose about the Parker family/Mayday continuity, not merely the generic lead template. |

**Boilerplate vs. copied plot text vs. coincidence:** repeated lead formulas and repeated handbook/reference/collected-edition listings explain many edges and are templated bibliographic material. Several top-weight related-character pairs also share long, exact story passages, which is more than a common phrase and is best described as duplicated plot/editorial prose. I found no basis for inferring which page copied from which, and a graph edge—even at n=8—does not establish that two whole pages are copies. Generic 6-gram matches are especially weak evidence.

## M3 — bag-of-words cosine search

Queries are tokenized by the rule above. Each query and page is a raw count vector over the corpus vocabulary; ranking is cosine similarity. The two result columns use all tokens or remove spaCy 3.8.16 English stopwords from both query and page vectors. Top five are shown in rank order; ties break by character name.

For compactness, parenthetical disambiguators are omitted from some result labels below; rankings use the full node names.

| Query | Stopwords kept: top 5 | Stopwords removed: top 5 |
| --- | --- | --- |
| Norse god of thunder | Starr the Slayer; Fabio Medina; Doom 2099; Balder the Brave; Xorn | Starhawk; Hercules; Ares; Balder the Brave; Ajak |
| web-slinging teenager | Spider-UK; Spider-Man Noir; Solo; Solarman; Nightwatch | Nightwatch; Spider-Man Noir; Spider-UK; Solo; Solarman |
| adamantium claws | Wolverine; White Tiger (Heroes for Hire); Wolverine (Ultimate); Ravage 2099; Black Cat | Wolverine; Wolverine (Ultimate); White Tiger; Ravage 2099; Black Cat |
| gamma-powered green giant | Phil Urich; Bill Foster; Gauntlet; Hank Pym; Hulk 2099 | Phil Urich; Bill Foster; Hulk 2099; Gauntlet; Hulk |
| mutant school for gifted youngsters | Paladin; Redneck; Anole; Ricochet; Typeface | Redneck; Fabio Medina; Rusty Collins; Rockslide; Powerhouse |
| armored billionaire inventor | Redneck; Hornet; Force; Guardsman; Coldblood | Redneck; Turbo; Hornet; Guardsman; Stingray |
| cosmic purple warlord seeks infinity stones | Adam Warlock; Firelord; Genis-Vell; Kismet; Captain Universe | Adam Warlock; Kismet; Genis-Vell; Firelord; Moondragon |
| Sorcerer Supreme of Earth | Hyperion; Starr the Slayer; Doom 2099; Spider-UK; Fabio Medina | Alice Nugent; Hyperion; Moonglow; Blue Eagle; Doctor Strange |
| adoptive father of Star-Lord | Star-Lord; Star Brand; Father Time; Dragon Lord; Starr the Slayer | Star-Lord; Star Brand; Dragon Lord; Father Time; Nightmask |
| red-haired mutant telepath and telekinetic | Red Raven; Redneck; Red Wolf; Cloak and Dagger; Red Guardian | Red Wolf; Red Raven; Red Guardian; Redneck; Rusty Collins |
| archer with trick arrows | Outlaw; Raza Longknife; Blue Eagle; She-Venom; Hrimhari | Hawkeye; Blue Eagle; Father Time; Red Wolf; Nomad |
| World War II super soldier frozen in ice | Jeffrey Mace; Peggy Carter; Super Rabbit; Captain Midlands; War Machine | Isaiah Bradley; War Machine; Breeze Barton; Jeffrey Mace; Super Rabbit |
| alien symbiote bonded to journalist | Mania; Eddie Brock; Venom; Agent X; Wolverine (Ultimate) | Mania; Eddie Brock; Venom; Hybrid; Raza Longknife |
| tiny subatomic insect heroine | Hornet; Charcoal; Ms. Marvel; Blue Diamond; Hank Pym | Hornet; Charcoal; Blue Diamond; Hank Pym; Ms. Marvel |
| the thing with rocky orange skin | Man-Thing; Human Torch (android); Alice Nugent; Blazing Skull; Crane Mother | Man-Thing; Blue Diamond; Ethan Edwards; Toxyn; Straw Man |
| friendly neighborhood hero in Queens | Happy Sam Sawyer; Ms. Marvel; Peggy Carter; Jeffrey Mace; Baymax | Baymax; Phil Grayfield; Living Lightning; Black Rider; Luke Cage |
| king of Wakanda | Starr the Slayer; Shuri; Doom 2099; Fabio Medina; Black Panther | Shuri; Black Panther; Storm; The Union; Blade |
| he heals quickly and has claws | Dargo Ktor; Solo; Crippler; Steel Spider; Killpower | Wolverine (Ultimate); White Tiger; Wolverine; Hulk 2099; Flatman |
| what did the character eat for breakfast yesterday | Scarlet Scarab; Human Torch (android); Junior Juniper; Hulk 2099; Straw Man | The Witness; Sabra; Charcoal; Fabio Medina; Miracleman |
| xqzzy plorbin experimental phrase | Phil Grayfield; Thunderbolt; Ravage 2099; Living Lightning; White Tiger | Phil Grayfield; Thunderbolt; Living Lightning; Ravage 2099; Battlestar |

**Failure taxonomy, checked against the pages:**

- **Target absent:** this network corpus has no plain Thor or main Iron Man page (it has Thor Girl, Iron Man (Ultimate Marvel character), and Iron Man 2020). “Norse god of thunder” and “armored billionaire inventor” cannot retrieve an absent target. The relevant word counts are sparse too: `norse` 14, `billionaire` 8, `inventor` 18 corpus occurrences.
- **Synonym/description mismatch:** “web-slinging teenager” has only 3 occurrences of `slinging`; “teenager” occurs 53 times. `Spider-Man` is described through its own name and other wording, not that exact phrase.
- **Stopword dilution:** “archer with trick arrows” ranks Outlaw first with stopwords retained and Hawkeye first after removal. “King of Wakanda” moves from noisy results to Shuri and Black Panther after removing `of`.
- **Surface overlap, not meaning:** “the thing with rocky orange skin” puts Man-Thing first in both variants; the shared word `thing` is ambiguous. “Cosmic purple warlord…” returns Adam Warlock first, a franchise-neighbor/word-overlap result rather than the intended entity.
- **No evidence / generic terms:** the breakfast question and invented phrase return arbitrary pages; for the invented phrase all scores are near zero and the displayed top-five is not meaningful. Cosine reduces raw length effects but does not understand paraphrase, entity identity, or whether a matching word is relevant.

## M4 — community autocomplete

Used our own deterministic NetworkX Louvain partition of the undirected Week 1 graph (seed `260927`, resolution `1`), not a Week 4 Marvel partition: 25 communities, modularity 0.387066. The five largest have sizes **59, 51, 47, 44, 30**. Each community model was trained on its members’ token streams. Generation uses trigram counts, backs off to bigram then unigram, multiplying the backed-off score by **0.4 per order** (“stupid backoff”); there is no additive pseudo-count. Three 120-word samples per community were generated with fixed seeds `260927 + 10*community_id + replicate`.

All 15 outputs were inspected. They are **not readable fake pages**: the letter-only pipeline removed punctuation and capitalization, and the model concatenated unrelated clauses and plot fragments. Brief sample openings (shown only as short excerpts) illustrate the issue:

- Community 1: “star lord appears in marvel knights eternals…”
- Community 2: “she hulk attorney at law…”
- Community 3: “ruby summers as the squad leader…”
- Community 4: “blue eagle kills golden archer…”
- Community 5: “satana hellstrom and the character's return…”

For the name-leak test, I searched each sample for exact, unambiguous multiword character names (also testing a disambiguation-stripped form), assigned each hit its character’s community, and predicted by majority name votes. **14/15 samples contained a qualifying name; 14/14 covered samples were assigned to their generating community (100%, vs. 20% chance for five classes); one sample abstained.** This is a name-leak diagnostic, not evidence that the generated prose is readable or that an independent reader can classify it without names. Before presenting a text-based classification experiment, mask character names and aliases in the training corpus with a neutral token, mask any residuals in output, and rerun the baseline.

## M7 — length-controlled weird-page ranking

Four measures were combined by average within-bin percentile rank: type-token ratio (higher), non-alphabetic share among word-like tokens (higher), zlib compressed/raw byte ratio (higher = less compressible), and cosine distance from the mean normalized bag-of-words corpus centroid (higher). Pages were sorted by alphabetic-token length into ten near-equal-count bins; each measure was ranked **within its length bin** before averaging. This reduces, but does not eliminate, length confounding. Hapax share was inspected but excluded from the composite because it largely duplicates TTR.

| Rank | Page | Tokens | Avg. rank | TTR | Non-alpha | zlib ratio | Centroid distance | Raw-text read |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | Shamrock (comics) | 1,058 | .931 | .456 | .055 | .466 | .146 | Distinctive luck/poltergeist premise; also ordinary publication and reception sections. |
| 2 | Guardsman (character) | 1,761 | .867 | .433 | .043 | .444 | .115 | Multiple incarnations/codename; some diversity is real subject matter. |
| 3 | Super Rabbit | 471 | .858 | .556 | .096 | .509 | .275 | Talking-animal Golden Age character; issue/date/currency symbols add formatting noise. |
| 4 | Ravage 2099 | 992 | .850 | .502 | .045 | .492 | .144 | Dystopian/ecological premise and distinctive quoted creator history. |
| 5 | Bob, Agent of Hydra | 963 | .833 | .476 | .027 | .469 | .277 | Deadpool/Hydra sidekick history; mostly short-page lexical specificity. |
| 6 | Cammi (character) | 529 | .810 | .544 | .019 | .492 | .211 | Short Drax/Avengers Arena biography. |
| 7 | Captain Midlands | 633 | .810 | .528 | .034 | .483 | .193 | British veteran characterization; short and lexically specific. |
| 8 | Chase Stein | 3,733 | .810 | .321 | .029 | .409 | .128 | Runaways family/identity storyline; longer than most top-ranked entries. |
| 9 | Patsy Walker | 4,363 | .810 | .334 | .047 | .410 | .095 | Long shift from teen-comics history to Hellcat; article structure contributes. |
| 10 | Coldblood | 683 | .802 | .558 | .024 | .490 | .201 | Cyborg/identity plot; short-page lexical distinctiveness. |

Brief raw-text fragments confirming the subjects (full page text is not reproduced): **Shamrock** — “vessel for displaced poltergeists”; **Guardsman** — “the name of several characters”; **Super Rabbit** — “a talking animal superhero”; **Ravage 2099** — “Paul-Phillip Ravage”; **Bob** — “a sidekick of Deadpool”; **Cammi** — “Camille Benally”; **Captain Midlands** — “Sid Ridley”; **Chase Stein** — “also known as Talkback”; **Patsy Walker** — “became Hellcat”; **Coldblood** — “Eric Savin.”

The top ranks are a mix: Shamrock’s luck/poltergeist and Super Rabbit’s talking-animal premise are substantive, unusual page content; Ravage’s ecological/dystopian storyline is also genuine subject matter. High TTR/hapax values on short pages are partly small-sample effects even after decile control. Repeated section scaffolding and publication/reception/reference listings influence compression and lexical measures; Super Rabbit also contains unusual date/currency typography. The ranking is a lead for inspection, not a claim that these are objectively the strangest characters.

## Ranked shortlist: promising findings, not a selection

1. **Related character pages repeat long exact story prose.** Eddie Brock/Venom share 510 distinct 8-grams and a 57-token identical run; Cyclops/Jean Grey share 470 and a 102-token run. The passages were read in both raw pages and concern connected character/story histories, not just the repeated opening formula.
2. **Names alone make these autocomplete samples trivially classifiable.** Exact multiword-name votes predicted the generating Louvain community for all 14 samples with a detected name, compared with 20% chance. Raw output confirms these names are mixed into the synthetic text; the model’s unreadability is an important limitation, and names must be masked for a meaningful language-style test.
3. **The corpus is unusually well aligned with the course’s lexical sanity counts, while several search failures are structural.** The common tokenizer gives 727,258 tokens, 27,013 types, and 35.73% hapaxes, close to all three references. Raw node/page checks also show why some intended query answers are impossible: a Thor or main Iron Man page is not among the 303 documents. The remaining M3 failures (such as Hawkeye improving after stopword removal) show the limits of literal BoW matching.

These are candidates only. M2 connectivity is inflated by boilerplate, M4 is not readable prose, and M7 is a heuristic ranking; the raw-text checks and limitations above should accompany any final post claim.

## Append-only update: A–D corrections and additional measures

This section supersedes the earlier M2 connected-component summary and the earlier M4 name-leak baseline. It uses the extracted `data/marvel_pages/` corpus and excludes `README.txt`.

### A) M2 de-boilerplating and exact shared runs

Across the 303 pages there are 709,210 distinct 8-gram shingles. Their document-frequency distribution is strongly long-tailed:

| Shingle document frequency | Number of distinct 8-grams |
| --- | ---: |
| 1 page | 703,099 |
| 2 pages | 4,952 |
| 3–5 pages | 870 |
| 6–20 pages | 243 |
| More than 20 pages | 46 |

For each threshold K, I retained shingles with `2 ≤ df ≤ K`, added one edge for every page pair sharing at least one retained shingle, and weighted it by the count of distinct retained shared shingles. Isolated pages remain vertices in the component counts.

| Maximum df K | Network edges | Components | Largest components (pages) | Top weighted pairs (shared retained 8-grams) |
| ---: | ---: | ---: | --- | --- |
| 3 | 1,218 | 27 | 276, 2, then 25 singletons | Eddie Brock–Venom 466; Cyclops–Jean Grey 460; Spitfire–Union Jack 189; Mayday Parker–Spider-Woman 189; Spitfire–Union Jack (Joseph Chapman) 182 |
| 5 | 1,856 | 21 | 283, then 20 singletons | Eddie Brock–Venom 478; Cyclops–Jean Grey 464; Spitfire–Union Jack 190; Mayday Parker–Spider-Woman 190; Ghost Rider–Ghost Rider (Johnny Blaze) 182 |
| 10 | 2,901 | 18 | 286, then 17 singletons | Eddie Brock–Venom 487; Cyclops–Jean Grey 465; Spitfire–Union Jack 192; Mayday Parker–Spider-Woman 190; Ghost Rider–Ghost Rider (Johnny Blaze) 188 |

The naive n=8 network has 40,570 edges and a largest component of **302/303** pages. With K=3, that falls to **276/303** in the largest component. Requiring a qualifying **prose** run of at least 30 tokens is much stricter: at K=3, 17 page-pair edges qualify, involving 26 pages total across 11 nontrivial components; the largest prose-connected component has **4 pages**. K=5 and K=10 give the same 17 qualifying edges and 26 participating pages, because these long prose runs are supported by shingles at df≤3. The high connectivity in the naive graph is not evidence of whole-page copying.

**Recommendation: K=3.** It removes the broadest repeated boilerplate while retaining the largest, strongest related-page overlaps. It still leaves 276 pages connected by short and/or templated bridges, so use the 30-token prose-run network when making a claim specifically about shared narrative prose. K=5 or 10 adds only seven or ten vertices to the largest component relative to K=3 while admitting more common shingles.

#### Maximal-run detection and labels

I merged adjacent exact shingles on the same page pair into maximal runs, extending token-by-token in both raw pages. There were 63,797 maximal pairwise runs of at least eight tokens. I ranked them by run length, then by that page pair’s shared-8-gram count; the 200th run is 18 tokens long.

The top 200 received a reproducible three-way rule: (1) **bibliographic/listing** if the passage contains an ISBN, TPB/trade-paperback/collected-edition/volume cue, at least two issue-number markers, or a dense title-case title span; (2) **templated lead/boilerplate** if it matches repeated article-opening/creator/Strikeforce: Morituri wording; otherwise (3) **prose**. This is a screening heuristic, not a semantic classifier. Applying it yielded 92 prose, 79 templated lead/boilerplate, 17 bibliographic/listing, and 12 dense-title-case listings.

I drew 20 runs uniformly from those top 200 with seed `260927`, printed and inspected each passage, and adjusted the template rule after that check. The final labels and full sampled passages are:

| # | Tokens | Class | Pages | Printed shared run |
| ---: | ---: | --- | --- | --- |
| 1 | 21 | Prose | Ghost Rider / Ghost Rider (Johnny Blaze) | “Following the Western comics character who originally used the name, the first superhero Ghost Rider, Johnny Blaze, debuted in Marvel Spotlight” |
| 2 | 20 | Prose | White Tiger (Heroes for Hire) / White Tiger (comics) | “Heroes for Hire. White Tiger tries to keep her origins a secret, but during a training session with Iron Fist” |
| 3 | 19 | Templated | Scarlet Witch / She-Hulk | “is a character appearing in American comic books published by Marvel Comics. Created by writer Stan Lee and artist” |
| 4 | 18 | Prose | Alice Nugent / Hyperion (character) | “appears as a member of the Squadron Supreme of America. This version is a simulacrum created by Mephisto” |
| 5 | 28 | Bibliographic | Cyclops / Storm | “ISBN 978-1-394-36274-5. Cebulski, C.B., ed. (2024). Marvel Encyclopedia: New Edition. DK. ISBN 978-0-5938-4611-7. Deman, J. Andrew (2023). The Claremont Run: Subverting Gender in the X-Men. University of Texas Press. ISBN” |
| 6 | 19 | Templated | Cyclops / Hulk | “is a superhero appearing in American comic books published by Marvel Comics. Created by writer Stan Lee and artist” |
| 7 | 19 | Templated | Abomination / She-Hulk | “is a character appearing in American comic books published by Marvel Comics. Created by writer Stan Lee and artist” |
| 8 | 19 | Prose | Eddie Brock / Venom | “Brock's hand is seen on-panel. The next indication of Venom's existence was in Web of Spider-Man #24 (March” |
| 9 | 29 | Prose | Battlestar / U.S. Agent | “has superhuman strength (capable of lifting 10 tons under maximum exertion), agility, reflexes and endurance. His speed, dexterity, coordination, and balance are of the order of a superior Olympic athlete” |
| 10 | 19 | Templated | Emma Frost / Empath | “is a character appearing in American comic books published by Marvel Comics. Created by writer Chris Claremont and artist” |
| 11 | 19 | Prose | Jessica Jones / Spider-Girl | “is the one who is bitten by the radioactive spider which gave Spider-Man his powers instead of Peter” |
| 12 | 18 | Bibliographic | Jessica Jones / Mockingbird | “appeared as a regular character throughout the 2010-2013 New Avengers series, from issue #1 (August 2010) through its final issue, #34 (January” |
| 13 | 21 | Bibliographic | Cyclops / Shang-Chi | “ISBN 978-0-14-313576-0. Wolk, Douglas (2021). All of the Marvels: A Journey to the Ends of the Biggest Story Ever Told. Penguin Press. ISBN” |
| 14 | 18 | Templated | Devil Dinosaur / Makkari | “character appearing in American comic books published by Marvel Comics. Created by Jack Kirby, the character first appeared” |
| 15 | 19 | Templated | Charcoal / Rockslide | “appearing in American comic books published by Marvel Comics. The character has been depicted as a member of the” |
| 16 | 26 | Prose | Eddie Brock / Venom | “when he was the artist on Iron Fist to explain how that character's costume was constantly being torn and then apparently repaired by the next issue” |
| 17 | 21 | Prose | Power Man (Victor Alvarez) / She-Hulk (Lyra) | “part of the new class of students when the Avengers Academy moves to the former headquarters of the West Coast Avengers” |
| 18 | 18 | Bibliographic | Iron Fist / Mockingbird | “appeared as a regular character throughout the 2010–2013 New Avengers series, from issue #1 (August 2010) through its final issue, #34 (January” |
| 19 | 21 | Templated | Blackthorn / Snapdragon | “depicted as a member of the Strikeforce: Morituri. The character was created by Peter B. Gillis and Brent Anderson. Publication history” |
| 20 | 34 | Prose | Rachel Summers / Storm | “In the new status quo for mutants post House of X and Powers of X, Professor X and Magneto invite all mutants to live on Krakoa and welcome even former enemies into their fold” |

#### Required pair checks: longest full raw-page runs

All four pairs are confirmed to share exact runs. The snippets below are the full maximal runs detected under the stated tokenizer, copied independently from both raw pages. Repetition direction cannot be established from this evidence.

**Cyclops (Marvel Comics) ↔ Jean Grey — 102 tokens**

Cyclops page:
> Cyclops leaves his wife and child behind to lead the reunited original X-Men, under the X-Factor name. Claremont expressed dismay that Jean's resurrection ultimately resulted in Cyclops abandoning his wife and child, tarnishing his written persona as a hero and "decent human being". For X-Factor, writer Bob Layton was partly inspired by the film Ghostbusters; the X-Factor team advertised themselves as mutant hunters, but worked to rehabilitate and educate the mutants they discovered. Layton left the title after five issues and was replaced by Louise Simonson, who introduced the new villain Apocalypse, first appearing in X-Factor #6 (July

Jean Grey page:
> Cyclops leaves his wife and child behind to lead the reunited original X-Men, under the X-Factor name. Claremont expressed dismay that Jean's resurrection ultimately resulted in Cyclops abandoning his wife and child, tarnishing his written persona as a hero and "decent human being".
>
> For X-Factor, writer Bob Layton was partly inspired by the film Ghostbusters; the X-Factor team advertised themselves as mutant hunters, but worked to rehabilitate and educate the mutants they discovered. Layton left the title after five issues and was replaced by Louise Simonson, who introduced the new villain Apocalypse, first appearing in X-Factor #6 (July

**Eddie Brock ↔ Venom — 57 tokens**

Eddie Brock page:
> explaining that he ended up not using the idea on that title, but that Roger Stern later asked him if he could use the idea for Spider-Man's alien costume. Stern in turn plotted the issue in which the costume first appeared but then left the title. It was writer Tom DeFalco and artist Ron Frenz who

Venom page:
> explaining that he ended up not using the idea on that title, but that Roger Stern later asked him if he could use the idea for Spider-Man's alien costume. Stern in turn plotted the issue in which the costume first appeared but then left the title. It was writer Tom DeFalco and artist Ron Frenz who

**Spider-Woman ↔ Spider-Woman (Jessica Drew) — 129 tokens**

Spider-Woman page:
> the character originated because,
>
> I suddenly realized that some other company may quickly put out a book like that and claim they have the right to use the name, and I thought we'd better do it real fast to copyright the name. So we just batted one quickly, and that's exactly what happened. I wanted to protect the name, because it's the type of thing [where] someone else might say, "Hey, why don't we put out a Spider-Woman; they can't stop us." ... You know, years ago we brought out Wonder Man, and [DC Comics] sued us because they had Wonder Woman, and ... I said okay, I'll discontinue Wonder Man. And all of a sudden they've got Power Girl [after Marvel had introduced Power Man]. Oh, boy. How unfair

Spider-Woman (Jessica Drew) page:
> the character originated because
>
> I suddenly realized that some other company may quickly put out a book like that and claim they have the right to use the name, and I thought we'd better do it real fast to copyright the name. So we just batted one quickly, and that's exactly what happened. I wanted to protect the name, because it's the type of thing [where] someone else might say, 'Hey, why don't we put out a Spider-Woman; they can't stop us.' ... You know, years ago we brought out Wonder Man, and [DC Comics] sued us because they had Wonder Woman, and... I said okay, I'll discontinue Wonder Man. And all of a sudden they've got Power Girl [after Marvel had introduced Power Man]. Oh, boy. How unfair

**Mayday Parker ↔ Spider-Woman — 166 tokens**

Mayday Parker page:
> For the first ten years of their lives, the two were solely raised by Mary Jane in Portland, Oregon after she left Peter following a traumatic incident. In 1995, Peter lets Ben Reilly take over his life as Spider-Man and CEO of Parker Industries so he could return to his family. In the mid-2000s, Claire convinces Peter to return to New York and become Spider-Man once more shortly after Morlun kills Ben Reilly so he could stop Tony Stark from taking over Parker Industries and to lure Morlun away from his family. Despite his efforts, Morlun attacks the twins and Mary Jane in Oregon as Peter gets involved in the superhero Civil War. When Benjy discovers that Morlun is vulnerable when he is feeding off someone, he uses himself as bait to allow Claire the chance to impale him on a splintered log of wood. Benjy survives the assault, but is crippled for life. By 2019, Claire has become Spider-Woman (now wearing a costume

Spider-Woman page:
> For the first ten years of their lives, the two were solely raised by Mary Jane in Portland, Oregon after she left Peter following a traumatic incident. In 1995, Peter lets Ben Reilly take over his life as Spider-Man and CEO of Parker Industries so he could return to his family. In the mid-2000s, Claire convinces Peter to return to New York and become Spider-Man once more shortly after Morlun kills Ben Reilly so he could stop Tony Stark from taking over Parker Industries and to lure Morlun away from his family. Despite his efforts, Morlun attacks the twins and Mary Jane in Oregon as Peter gets involved in the superhero Civil War. When Benjy discovers that Morlun is vulnerable when he is feeding off someone, he uses himself as bait to allow Claire the chance to impale him on a splintered log of wood. Benjy survives the assault, but is crippled for life. By 2019, Claire has become Spider-Woman (now wearing a costume

Three or more pages also share these exact passages:

- **Spitfire, Union Jack (Joseph Chapman), and Union Jack (Marvel Comics):** a 58-token collected-edition listing beginning “December 1998 - February 1999, TPB, 96 pages, April 2002, ISBN 0-7851-0934-X” and continuing into a *New Invaders: To End All Wars* trade-paperback entry.
- **The same three pages:** a 42-token collected-edition entry beginning “Captain America: War and Remembrance (by John Byrne and Roger Stern…)” and listing issue numbers, page count, date, and ISBN.
- **Radian, Scaredycat, and Scatterbrain (Morituri):** a 36-token templated lead beginning “is a superhero appearing in American comic books published by Marvel Comics. The character is depicted as a member of the Strikeforce: Morituri.”

These examples separate bibliography/list boilerplate and templated introductions from long repeated plot/editorial prose. They establish exact duplication, not which page was copied from which.

### B) M4 masked punctuation-aware redo

The M4-only tokenizer is `\w+|[^\w\s]` over Unicode text: word tokens and each punctuation token are kept separately, with capitalization retained. Before training, I replaced character name sequences with `CHARACTER` in both training texts and generated output. The mask includes **713 multi-token forms and 156 single-token proper-name forms**, assembled from the 303 node labels, URL titles, title-base forms, parenthetical identities in labels/leads, and explicit alias/real-name phrases in lead text. Single-token forms are replaced only when capitalized, to avoid turning ordinary lowercase words into false character masks. This is not an exhaustive named-entity recognizer; aliases outside those sources can escape.

The same five largest communities (59, 51, 47, 44, 30 pages) were retrained. Per-page sequences use sentence/page boundary markers. Generation uses trigram sampling with stupid backoff to bigrams and unigrams, multiplying the lower-order sampling weight by **0.4 per backoff**, with fixed seeds `260927 + 10*community_id + replicate`; each sample contains 120 word tokens, plus punctuation.

All 15 masked samples were read. **They are not readable fake pages.** Punctuation and capitalization now survive, but the passages still splice unrelated descriptions, reviews, issue listings, and plot events into incoherent sequences. Examples include “The Gremlin is a young age” (community 1), “Jameson concludes that CHARACTER might have been defined by her dual identity” (community 2), “During the Krakoan X-Men: First Class … Publication history The Golem…” (community 3), and “The CHARACTER is in love with CHARACTER. References External links…” (community 4). This is a documented negative result, not a useful quiz.

For the name-free baseline, I excluded the `CHARACTER` placeholder and punctuation, represented each sample as a count vector, and computed cosine similarity to each of the five **masked training-corpus community count centroids**. The highest-similarity community was correct for **11/15 samples (73.3%)**, against 20% chance. By generating community, correct predictions were C1 2/3, C2 2/3, C3 3/3, C4 3/3, and C5 1/3. This is not an independent held-out evaluation: samples were generated from the same community corpora used to form the centroids, so above-chance accuracy is expected and does not establish that a reader can identify the community from readable prose. It does show a measurable residual community signal after masking the listed character names/aliases.

### C) M1, M5, and M6

**M1 — conservative textual edge types.** The visible earlier prompts do not specify a semantic edge-type ontology. Rather than invent one, I report a reproducible text-evidence typing for the 1,784 directed Week 1 edges: (a) target-title evidence when the source page contains the target's display name, parenthetical-disambiguation-stripped name, or URL-title form as a case-insensitive word-boundary match; (b) no detected target-title evidence otherwise. This labels **1,574 edges as mention-supported** and **210 as linked but not confirmed by those literal title forms**. These are evidence types, not semantic relations (such as “ally” or “enemy”); aliases and ambiguous short names can cause false negatives or positives. If M1 was intended to use a different type definition, that definition was not present in the prompts visible here.

**M5 — Heaps’ law.** I concatenated whole pages in 100 seeded random page orders (`260927`), averaged vocabulary size at cumulative-token checkpoints, then fit `V = K N^β` by least squares in log space. Result: **K = 15.48, β = 0.5593, R² = 0.9941** over the nine checkpoints. Average vocabulary rose from about 1,997 types at 1% of tokens (7,273 tokens) to 8,794 at 10%, 19,824 at 50%, and 27,013 at all 727,258 tokens. Page-order averaging reduces the arbitrary-order effect; this is a corpus-level descriptive fit, not a universal growth law.

**M6 — fame proxy versus article length.** I used undirected degree in the Week 1 projection as the fame/visibility proxy and the agreed alphabetic-token count as page length. Spearman correlation across 303 pages is **ρ = 0.832** (degree versus token count); degree versus character count is ρ = 0.833. Spider-Man leads degree (106) and has a 10,292-token page; Hulk (65) has 7,492 tokens; Wolverine (63) 7,328; Doctor Strange (57) 6,858. The longest page is Scarlet Witch (14,167 tokens; degree 32), so fame proxy and length are strongly associated but not interchangeable. Degree measures link connectivity, not an external measure of real-world fame, and the correlation is not causal.

### D) Node-list check for missing famous characters

The Week 1 `name` and `node_id` columns contain **no exact plain `Thor` node** and **no exact main `Iron Man` node**. They contain **Thor Girl**, **Iron Man (Ultimate Marvel character)**, and **Iron Man 2020**, which are distinct page titles/versions; none is a plain Thor or main Iron Man entry. Other recognizable examples with no corresponding exact node title in this 303-page list include **Captain America, Daredevil, Fantastic Four, Mr. Fantastic, Invisible Woman, Ant-Man, Wasp, Loki, Thanos, Silver Surfer, Punisher, Vision, Falcon, and Winter Soldier**. This is a node-title inventory check, not a claim that those names never appear in the article text.

### A) Full three-page shared passages

For completeness, here are full raw passages found identically in three pages (case differences in `TPB`/`tpb` are immaterial to the lowercased token match):

**Spitfire (character), Union Jack (Joseph Chapman), and Union Jack (Marvel Comics) — 58 tokens**

```text
December 1998 - February 1999, TPB, 96 pages, April 2002, ISBN 0-7851-0934-X)
New Invaders: To End All Wars (written by Allan Jacobsen, with art by Jorge Lucas and C. P. Smith, TPB collects New Invaders #1-9, October 2004 - June 2005, 216 pages, July 2005, ISBN 0-7851-1449-1)
Captain America: Red Menace Volume 2 (written by Ed Brubaker with art by Steve Epting, TPB collects Captain America #18-21, July - October 2006, 104 pages, December 2006, ISBN
```

**Radian (Morituri), Scaredycat, and Scatterbrain (Morituri) — 36 tokens**

```text
is a superhero appearing in American comic books published by Marvel Comics. The character is depicted as a member of the Strikeforce: Morituri. The character was created by Peter B. Gillis and Brent Anderson.



Publication history
```


