#!/bin/bash
# Cut the recorded chapters into the final film, in story order, with the
# generation wait ramped hard and the payoffs left near real time.
#
#   bash scratchpad/assemble2.sh
#
# Every piece is re-encoded to one size so `-c copy` can concat them; libx264
# also rejects an odd height, hence the explicit pad.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/segments"
rm -rf cut && mkdir -p cut

W=1100; H=640
have () { [ -f "$1" ]; }
piece () {  # piece <out> <file> <start> <dur> <speed>
  if ! have "$2"; then echo "  SKIP $1 (no $2)"; return; fi
  ffmpeg -y -loglevel error -ss "$3" -t "$4" -i "$2" \
    -vf "setpts=PTS/$5,scale=$W:$H:force_original_aspect_ratio=decrease,pad=$W:$H:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30" \
    -an -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p "cut/$1.mp4"
  printf "  %-16s %5.1fs\n" "$1" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 cut/$1.mp4)"
  ORDER="$ORDER $1"
}
ORDER=""

echo "cutting..."
# --- act 1: the hook and the problem -------------------------------------
piece p01 01-hook.mp4            8  112  2.3     # empty room -> 50 tables -> full
piece p02 02-card-problem.mp4    1   15  1.0     # card: the same living room
piece p03 02-landing.mp4         4   84  2.2     # the landing

# --- act 2: how it works, live -------------------------------------------
piece p04 04-card-how.mp4        1   16  1.0     # card: the pipeline
piece p05 05-upload.mp4          5   50  1.7     # live upload + culture pick
piece p06 06-generate.mp4        2   40  1.25    # start of the real render
piece p07 06-generate.mp4      44  650  11.0     # the wait, ramped
piece p08 07-reveal.mp4          2   50  1.15    # wipe + three cultures
piece p09 08-xray.mp4            1   27  1.1     # provenance x-ray
piece p10 09-understand.mp4      3   45  1.7     # elements, plan, depth
piece p11 10-edit.mp4            3   55  1.6     # paint the wall + furniture

# --- act 3: the designer -------------------------------------------------
piece p12 11-card-gates.mp4      1   17  1.0     # card: six gates
piece p13 08-scenarios.mp4      6  280  2.6     # four briefs back to back
piece p14 09-build.mp4          4   62  1.6     # plan view, times of day, undo

# --- act 4: the headline -------------------------------------------------
piece p15 14-render.mp4          4  150  1.6     # handoff panel -> render -> new tab
piece p16 15-card-holds.mp4      1   16  1.0     # card: held / not held

# --- act 5: the rest of the product --------------------------------------
piece p17 11-theme.mp4          4   50  2.0
piece p18 12-arabic.mp4         1   15  1.1
piece p19 14-history.mp4        4   66  2.2
piece p20 15-evaluation.mp4     4   78  2.0
piece p21 21-card-close.mp4      1   17  1.0     # closing card

cd cut
: > list.txt
for f in $ORDER; do echo "file '$f.mp4'" >> list.txt; done
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy $ROOT/DarDesign-full-silent.mp4

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $ROOT/DarDesign-full-silent.mp4)
echo
echo "silent cut: ${DUR}s"

# --- music: trim the bed to length, fade it, mux ---------------------------
cd ..
if [ -f "$ROOT/music-bed.m4a" ]; then
  ffmpeg -y -loglevel error -i $ROOT/DarDesign-full-silent.mp4 -i $ROOT/music-bed.m4a \
    -filter_complex "[1:a]atrim=0:${DUR},asetpts=N/SR/TB,afade=t=out:st=$(python -c "print(max(0,$DUR-6))"):d=6[m]" \
    -map 0:v -map "[m]" -c:v copy -c:a aac -b:a 160k -shortest $ROOT/DarDesign-FYP.mp4
  echo "with music: $(ffprobe -v error -show_entries format=duration -of csv=p=0 $ROOT/DarDesign-FYP.mp4)s"
else
  cp $ROOT/DarDesign-full-silent.mp4 $ROOT/DarDesign-FYP.mp4
  echo "no music bed found - shipped silent"
fi
