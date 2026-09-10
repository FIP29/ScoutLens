// =============================================================================
// Problem 2 - Bilingual Subtitle Synchronizer
//
// Align transcript A (m words) with transcript B (n words) so that pairings never
// cross, maximising  sum(sim[i][j] over pairs) - P * (number of skipped words).
//
// This is a maximisation sequence-alignment (Needleman-Wunsch) problem.  The
// "no crossing" rule is exactly what makes the optimal substructure work: once
// we decide what happens to the LAST word of each prefix, the rest of the
// problem is the same problem on shorter prefixes.
//
// Let dp[i][j] = best score aligning A[0..i-1] with B[0..j-1].  The last word of
// each prefix falls into exactly one of three cases:
//
//     dp[i][j] = max( dp[i-1][j-1] + sim[i-1][j-1],   // pair A_i with B_j
//                     dp[i-1][j]   - P,               // skip A_i
//                     dp[i][j-1]   - P )              // skip B_j
//
//     dp[0][0] = 0,  dp[i][0] = -i*P,  dp[0][j] = -j*P
//
// A pairing is never forced: if sim[i][j] < -2P, skipping both words scores
// better and the recurrence picks that automatically (see sample 3).
//
// The answer is dp[m][n].  Each row only depends on the previous one, so two
// rolling rows are kept instead of the full m x n table.
// =============================================================================

#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

using std::max;
using std::vector;

typedef long long ll;

// -------------------------------------------------------- fast integer reader
// Up to m*n = 4,000,000 signed integers arrive on stdin, so buffered character
// reading is used instead of one scanf call per value.
static const int BUF_SIZE = 1 << 16;
static char inBuf[BUF_SIZE];
static int inPos = 0, inLen = 0;

static inline int readChar() {
    if (inPos == inLen) {
        inLen = static_cast<int>(fread(inBuf, 1, BUF_SIZE, stdin));
        inPos = 0;
        if (inLen <= 0) return -1;
    }
    return inBuf[inPos++];
}

static inline bool readInt(int& out) {
    int ch = readChar();
    while (ch != -1 && (ch < '0' || ch > '9') && ch != '-') ch = readChar();
    if (ch == -1) return false;

    bool negative = false;
    if (ch == '-') {
        negative = true;
        ch = readChar();
    }
    int value = 0;
    while (ch >= '0' && ch <= '9') {
        value = value * 10 + (ch - '0');
        ch = readChar();
    }
    out = negative ? -value : value;
    return true;
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
    int m, n, p;
    if (!readInt(m) || !readInt(n) || !readInt(p)) return 0;

    vector<ll> previous(n + 1), current(n + 1);
    vector<int> row(n);

    // Base row: aligning an empty prefix of A against j words of B skips all j.
    for (int j = 0; j <= n; ++j) previous[j] = -static_cast<ll>(j) * p;

    for (int i = 1; i <= m; ++i) {
        for (int j = 0; j < n; ++j) readInt(row[j]);

        // Base column: j == 0 means every one of the i words of A is skipped.
        current[0] = -static_cast<ll>(i) * p;

        for (int j = 1; j <= n; ++j) {
            ll paired  = previous[j - 1] + row[j - 1];   // pair A_i with B_j
            ll skipA   = previous[j] - p;                // skip A_i
            ll skipB   = current[j - 1] - p;             // skip B_j
            current[j] = max(paired, max(skipA, skipB));
        }
        previous.swap(current);
    }

    printf("%lld\n", previous[n]);
    return 0;
}
