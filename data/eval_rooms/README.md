# Evaluation rooms

Put 10–15 room photos here — these are the inputs the evaluation corpus is
generated from. The folder ships empty on purpose: the images are yours to
choose, and committing a corpus would bloat the repo.

**Use rooms that are not in `datasets/*/images`.** Measuring on the photos a LoRA
was trained on flatters every metric, and it is the first thing an examiner will
check.

The filename becomes the room id, so keep it simple and stable:

```
room_01.jpg
room_02.jpg
...
```

Then follow [CORPUS.md](../../eval/CORPUS.md). On Colab the same images live in
`MyDrive/DarDesign/evaluation/inputs/` so they outlive the session.
