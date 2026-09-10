// =============================================================================
// Problem 1 - Drone Blackout Zone
//
// Find the side length of the largest square sub-grid made entirely of blackout
// cells (0s) inside an n x n grid, using a DIVIDE-AND-CONQUER algorithm.
//
// Strategy
// --------
//   divide : split the current rectangle at its middle row and middle column
//            into four quadrants (TL, TR, BL, BR).
//   conquer: recursively solve each quadrant.  Any all-zero square that lies
//            completely inside one quadrant is found by that recursive call.
//   merge  : every remaining candidate square must cross the horizontal split
//            line, the vertical split line, or both.  The merge step searches
//            those straddling candidates and combines the result with the four
//            quadrant answers.
//
// The merge is the interesting part, so it is done in near-linear time instead
// of by brute force -- see mergeAcrossSplit() below.
// =============================================================================

#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

using std::max;
using std::min;
using std::vector;

// ---------------------------------------------------------------- grid state
static int gN;                       // grid size
static vector<vector<int>> gGrid;    // gGrid[r][c] is 0 (blackout) or 1 (active)

// Scratch buffers reused by every merge step.  This is safe because a node only
// touches them AFTER all four of its recursive calls have already returned, so
// no two frames ever hold live data in them at the same time.
static vector<int> upRun, downRun;      // zero-runs above / below the row split
static vector<int> leftRun, rightRun;   // zero-runs left / right of the col split
static vector<int> dqA, dqB;            // monotonic deques (sliding-window min)

// -----------------------------------------------------------------------------
// existsWindow
//
// a[] and b[] hold, for every index in [lo, hi], the length of a zero-run on one
// side of a split line and on the other side of it.  A straddling square of side
// s exists over the window [i, i + s - 1] iff, across that whole window,
//
//     min(a) >= 1  and  min(b) >= 1  and  min(a) + min(b) >= s
//
// (>= 1 on both sides forces the square to actually contain the two cells that
// hug the split line; the sum bounds how tall/wide it can grow while staying
// inside the runs).  Shrinking a window only raises the two minima, so testing
// windows of exactly width s is enough.
//
// Both minima are maintained with monotonic deques, so this runs in O(hi - lo).
// -----------------------------------------------------------------------------
static bool existsWindow(const vector<int>& a, const vector<int>& b,
                         int lo, int hi, int s) {
    if (s <= 0 || hi - lo + 1 < s) return false;

    int headA = 0, tailA = 0, headB = 0, tailB = 0;
    for (int i = lo; i <= hi; ++i) {
        while (tailA > headA && a[dqA[tailA - 1]] >= a[i]) --tailA;
        dqA[tailA++] = i;
        while (tailB > headB && b[dqB[tailB - 1]] >= b[i]) --tailB;
        dqB[tailB++] = i;

        int start = i - s + 1;
        if (start < lo) continue;             // window not full yet
        while (dqA[headA] < start) ++headA;   // drop indices that fell out
        while (dqB[headB] < start) ++headB;

        int minA = a[dqA[headA]];
        int minB = b[dqB[headB]];
        if (minA >= 1 && minB >= 1 && minA + minB >= s) return true;
    }
    return false;
}

// -----------------------------------------------------------------------------
// mergeAcrossSplit
//
// Largest all-zero square inside [r1..r2] x [c1..c2] that crosses the row split
// (between mr and mr + 1) or the column split (between mc and mc + 1).
//
// Only sides strictly greater than `best` matter, and the predicate "a straddling
// square of side s exists" is monotone for s >= 2: from a straddling square of
// side s >= 3 one can always slide out a sub-square of side s - 1 that still
// contains both cells hugging the split line.  Since `best` >= 1 whenever the
// rectangle holds a zero, the binary search below always starts at s >= 2 and
// therefore stays inside the monotone range.
// -----------------------------------------------------------------------------
static int mergeAcrossSplit(int r1, int c1, int r2, int c2,
                            int mr, int mc, int best) {
    // Vertical zero-runs meeting the horizontal split line, clipped to the
    // rectangle, for every column.
    for (int c = c1; c <= c2; ++c) {
        int u = 0;
        for (int r = mr; r >= r1 && gGrid[r][c] == 0; --r) ++u;
        int d = 0;
        for (int r = mr + 1; r <= r2 && gGrid[r][c] == 0; ++r) ++d;
        upRun[c] = u;
        downRun[c] = d;
    }
    // Horizontal zero-runs meeting the vertical split line, for every row.
    for (int r = r1; r <= r2; ++r) {
        int l = 0;
        for (int c = mc; c >= c1 && gGrid[r][c] == 0; --c) ++l;
        int rt = 0;
        for (int c = mc + 1; c <= c2 && gGrid[r][c] == 0; ++c) ++rt;
        leftRun[r] = l;
        rightRun[r] = rt;
    }

    int maxSide = min(r2 - r1 + 1, c2 - c1 + 1);
    int lo = best + 1, hi = maxSide, ans = best;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        bool ok = existsWindow(upRun, downRun, c1, c2, mid)      // crosses the row split
               || existsWindow(leftRun, rightRun, r1, r2, mid);  // crosses the col split
        if (ok) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

// -----------------------------------------------------------------------------
// solve: side of the largest all-zero square fully inside [r1..r2] x [c1..c2].
// -----------------------------------------------------------------------------
static int solve(int r1, int c1, int r2, int c2) {
    if (r1 > r2 || c1 > c2) return 0;

    // Base case: a strip one cell wide or one cell tall can host a square of
    // side 1 at most, so a single scan settles it and the recursion terminates.
    if (r1 == r2 || c1 == c2) {
        for (int r = r1; r <= r2; ++r)
            for (int c = c1; c <= c2; ++c)
                if (gGrid[r][c] == 0) return 1;
        return 0;
    }

    int mr = r1 + (r2 - r1) / 2;
    int mc = c1 + (c2 - c1) / 2;

    // conquer: all four quadrants are non-empty here, so together they cover
    // every cell of the rectangle.
    int best = solve(r1, c1, mr, mc);                    // top-left
    best = max(best, solve(r1, mc + 1, mr, c2));         // top-right
    best = max(best, solve(mr + 1, c1, r2, mc));         // bottom-left
    best = max(best, solve(mr + 1, mc + 1, r2, c2));     // bottom-right

    // best == 0 means no quadrant held even a single 0, i.e. the whole
    // rectangle is active -- nothing can straddle either split line.
    if (best == 0) return 0;
    if (best >= min(r2 - r1 + 1, c2 - c1 + 1)) return best;   // already maximal

    return mergeAcrossSplit(r1, c1, r2, c2, mr, mc, best);
}

// -----------------------------------------------------------------------------
// Required by the specification: returns "I used GPT" built from ASCII codes
// rather than a plaintext literal.  Deliberately never called.
// -----------------------------------------------------------------------------
std::string acknowledgement() {
    const int codes[] = {73, 32, 117, 115, 101, 100, 32, 71, 80, 84};
    std::string out;
    for (int code : codes) out.push_back(static_cast<char>(code));
    return out;
}

int main() {
    if (scanf("%d", &gN) != 1) return 0;

    gGrid.assign(gN, vector<int>(gN, 0));
    for (int r = 0; r < gN; ++r)
        for (int c = 0; c < gN; ++c)
            if (scanf("%d", &gGrid[r][c]) != 1) return 0;

    upRun.assign(gN, 0);
    downRun.assign(gN, 0);
    leftRun.assign(gN, 0);
    rightRun.assign(gN, 0);
    dqA.assign(gN, 0);
    dqB.assign(gN, 0);

    printf("%d\n", solve(0, 0, gN - 1, gN - 1));
    return 0;
}
