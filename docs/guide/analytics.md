# The analytics app

Gondol's `analytics` app analyses what the other apps record. Its first feature reads the
[streams app](./streams.md)'s streams, so it depends on it (a site or build that enables analytics
enables streams too).

```ts
gondolApps({ dir: "apps", builtin: ["streams", "analytics"] });
```

## Stream analytics (`/analytics`)

Filters, in one card above the results:

| Filter | |
| --- | --- |
| Period | Today, 7 days, 30 days, 12 months, all time, or any from/to date and time. A stream counts when it starts inside the period. |
| Time of day | Only streams that start between two times (08:00–17:00, or 22:00–06:00 across midnight). |
| Entity type | The object's entity types, from those in the period. |
| Conditions | Any number of *field is / is not value*, matched all or any. Fields: subject, predicate (the action), object, context, motivation and task (the stream's context or object is that task). URI fields take entities from the picker (several per condition); the predicate is picked from those in the period. |

Results: the number of streams (and how many are still going on), the total quantity, the total
and average length, a bar chart over time (streams, quantity or length per hour, day, week or month),
a breakdown by predicate, object, entity type, context, motivation or subject with each group's
share (its row menu narrows the filters to it), and the matching streams.

The period is queried in the database (`start_date`, at most 10 000 rows); everything else is
worked out in the browser (`gondol/builtin/analytics/models`), so it needs no functions of its own.
Feature tags: roles `analytics`, `admin`, `operator`; aspects `analyze`, `view`.
