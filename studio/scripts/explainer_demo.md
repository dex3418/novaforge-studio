---
title: Best time to buy and sell a stock
voice: en-IN-NeerjaNeural
rate: +0%
director: rules
palette: navy
brand: Novaforge Labs
handle: @novaforgelabs
---

## The trap
Buy at one. Sell at eight. That is a profit of seven. Right? Wrong, because you cannot sell before you buy.

```explainer
{
  "chart": "bars", "look": "clean", "title": "Daily price",
  "values": [3, 8, 2, 6, 1, 4], "labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  "cues": [
    { "frac": 0.05, "op": "tag", "target": 4, "text": "buy", "tone": "buy" },
    { "frac": 0.2,  "op": "hi",  "target": 1, "tone": "good" },
    { "frac": 0.3,  "op": "arc", "target": 4, "to": 1, "text": "+7", "tone": "good" },
    { "frac": 0.5,  "op": "note", "text": "8 - 1 = 7 ?" },
    { "frac": 0.7,  "op": "strike" }
  ]
}
```

## The right way
Look at it as a pipeline. Read the prices, remember the lowest so far, and check the profit at every day.

```explainer
{
  "chart": "flow", "look": "neon", "title": "One pass",
  "nodes": [ {"id":"a","label":"Read price"}, {"id":"b","label":"Lowest so far"}, {"id":"c","label":"Best profit"} ],
  "links": [ {"from":"a","to":"b"}, {"from":"b","to":"c","label":"compare"} ],
  "cues": [
    { "frac": 0.0, "op": "show", "target": "a" },
    { "frac": 0.35, "op": "show", "target": "b" },
    { "frac": 0.65, "op": "show", "target": "c" },
    { "frac": 0.8, "op": "hi", "target": "c", "tone": "buy" }
  ]
}
```
