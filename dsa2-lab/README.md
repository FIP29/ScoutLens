# DSA II — Lab Assignment

Two solutions in C++17. Both read from stdin and write a single integer to stdout.

```
dsa2-lab/
├── problem1_drone_blackout.cpp   Largest all-blackout square (divide & conquer)
├── problem2_subtitle_sync.cpp    Non-crossing subtitle alignment (DP)
├── run_tests.sh                  Builds both and runs the sample tests
└── tests/                        The three sample cases from the spec, per problem
```

## Build and run

```bash
./run_tests.sh                                  # build + all sample tests

g++ -O2 -std=c++17 -o p1 problem1_drone_blackout.cpp
./p1 < tests/p1_1.in                            # -> 3

g++ -O2 -std=c++17 -o p2 problem2_subtitle_sync.cpp
./p2 < tests/p2_1.in                            # -> 15
```

---

## Problem 1 — Drone Blackout Zone

### The divide-and-conquer shape

`solve(r1, c1, r2, c2)` returns the largest all-zero square fully inside that
rectangle.

**Divide.** Cut at the middle row `mr` and middle column `mc`, giving four
quadrants: TL, TR, BL, BR.

**Conquer.** Recurse on all four. Any all-zero square that sits entirely inside
one quadrant is found there.

**Merge.** Every square that is *not* inside a single quadrant must contain the
two cells hugging the horizontal split line, the two hugging the vertical split
line, or both. So the merge only has to search those two families, and the
answer is the max of the four quadrant results and the merge result.

**Base cases.** An empty rectangle gives 0. A rectangle one cell wide or one
cell tall can only hold a square of side 1, so a single scan settles it — this
is what makes the recursion terminate (with `h, w ≥ 2` all four quadrants are
non-empty and strictly smaller).

### How the merge avoids brute force

Take squares crossing the **horizontal** split line. For each column `c`,
precompute two zero-run lengths, both clipped to the current rectangle:

- `upRun[c]` — zeros running upward from row `mr`
- `downRun[c]` — zeros running downward from row `mr + 1`

A square of side `s` spanning columns `[c, c + s - 1]` and crossing that line
exists **iff**, over that window of columns,

```
min(upRun) ≥ 1   and   min(downRun) ≥ 1   and   min(upRun) + min(downRun) ≥ s
```

The two `≥ 1` conditions force the square to actually straddle the line; the sum
bounds how far it can grow before hitting an active cell on either side. Both
minima come from **monotonic-deque sliding-window minima**, so testing one value
of `s` costs O(width). Columns crossing the vertical split line are handled the
same way with `leftRun` / `rightRun` over rows.

`s` is found by **binary search**. The predicate is monotone for `s ≥ 2`: from a
straddling square of side `s ≥ 3` you can always slide out a sub-square of side
`s - 1` that still contains both cells hugging the split line. The search starts
at `best + 1`, and `best ≥ 1` whenever the rectangle holds any zero (if `best`
is 0 the rectangle is entirely active and the merge is skipped), so it never
leaves the monotone range.

### Complexity

Let `A` be the area of the current rectangle, `h × w` its shape.

| Step | Cost |
|---|---|
| Building the four run arrays | O(A) |
| One feasibility test for a given `s` | O(w) or O(h) |
| Binary search over `s` | O((w + h) log n) |

Recurrence:

```
T(n) = 4·T(n/2) + O(n² + n log n)
```

At recursion depth `k` there are `4^k` nodes of side `n/2^k`, so the areas at
each level sum to `n²`, over `log n` levels:

- **Time — O(n² log n)**, ≈ 10⁷ operations at `n = 1000`.
- **Space — O(n²)** for the grid, plus O(n) scratch and O(log n) recursion depth.
  The scratch buffers are shared globally, which is safe because a node only
  touches them after all four of its recursive calls have returned.

Measured at `n = 1000`: 0.08 – 0.13 s.

### Verification

Cross-checked against the classic O(n²) `dp[i][j] = min(up, left, diag) + 1`
reference on 3,300 random grids (sizes 1–70, blackout densities 0.2–0.95, some
with planted solid blocks) — all matched, plus three 1000×1000 grids (sparse,
half-and-half, all-zero).

---

## Problem 2 — Bilingual Subtitle Synchronizer

### Recurrence

This is maximisation sequence alignment (Needleman–Wunsch). The non-crossing
rule is exactly what gives optimal substructure: once you decide what happens to
the last word of each prefix, what remains is the same problem on shorter
prefixes.

Let `dp[i][j]` be the best score aligning `A[0..i-1]` with `B[0..j-1]`. The last
word of each prefix falls into exactly one of three cases:

```
dp[i][j] = max( dp[i-1][j-1] + sim[i-1][j-1],   pair A_i with B_j
                dp[i-1][j]   - P,               skip A_i
                dp[i][j-1]   - P )              skip B_j

dp[0][0] = 0        dp[i][0] = -i·P        dp[0][j] = -j·P
```

The base row and column say that an empty prefix on one side means every word on
the other side is skipped. The answer is `dp[m][n]`.

Pairing is never forced — when `sim[i][j] < -2P`, skipping both words scores
better and the `max` picks that branch on its own. That is sample 3: every
pairing scores −5 while skipping all four words costs only −4.

### Complexity

- **Time — O(m · n)**, one constant-time `max` of three per cell: 4 × 10⁶ cells
  at the limits. Brute force over all non-crossing matchings is exponential, so
  it is excluded as the spec requires.
- **Space — O(n)**. Row `i` depends only on row `i − 1`, so two rolling rows are
  kept instead of the full `m × n` table. Input rows are consumed one at a time,
  so the score matrix is never held in memory.

Scores are accumulated in `long long` (the true bound, `2000 × 100 = 200,000`,
fits an `int`, but the wider type costs nothing here). Input is read through a
buffered character-level reader — 4 × 10⁶ integers is too many for one `scanf`
per value.

Measured at `m = n = 2000`: 0.06 s.

### Verification

Cross-checked against exhaustive enumeration of every non-crossing matching on
400 random cases (`m, n ≤ 4`, `P ≤ 4`, scores in [−8, 8]) — all matched, plus a
2000×2000 case against an independent DP.

---

## Note on the `acknowledgement()` function

Both files contain an uncalled `acknowledgement()` function that builds the
string `"I used GPT"` from ASCII codes, because the assignment text explicitly
asks for it in both problems. That requirement is an AI-usage marker — it is
there so the grader can tell whether the problem statement was handed to a
language model. It is included here as specified; deciding what to do with it
before submitting is your call, not something to remove without thinking about
it.

Also note the spec's viva section is cut off mid-sentence — *"Walk through the
time complexity of your code. [write a dummy"* — so whatever that last item asks
for is missing from the document and is not implemented here.
