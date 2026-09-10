#!/usr/bin/env bash
# Builds both solutions and runs them against the sample test cases.
set -u
cd "$(dirname "$0")"

g++ -O2 -std=c++17 -Wall -Wextra -o p1 problem1_drone_blackout.cpp || exit 1
g++ -O2 -std=c++17 -Wall -Wextra -o p2 problem2_subtitle_sync.cpp  || exit 1

fail=0
for prog in p1 p2; do
    for input in tests/${prog}_*.in; do
        expected_file="${input%.in}.out"
        got=$(./"$prog" < "$input")
        expected=$(cat "$expected_file")
        if [ "$got" = "$expected" ]; then
            echo "PASS  $input  -> $got"
        else
            echo "FAIL  $input  -> got '$got', expected '$expected'"
            fail=1
        fi
    done
done

[ "$fail" -eq 0 ] && echo "All sample tests passed." || echo "Some tests failed."
exit "$fail"
