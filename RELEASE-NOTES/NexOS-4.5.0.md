# NexOS 4.5.0 — Study Studio Revision & Exam Planner

## What's new
- Persistent spaced-revision queue for topics missed in quizzes and flashcards marked **Again**.
- Review ratings: Again schedules tomorrow; Hard schedules a short interval; Got it advances through 1, 3, 7, 14 and 30-day intervals.
- Revision dashboard shows due items and tracked topics.
- Exam planner stores exam date, daily study minutes, topic checklist and completion progress.
- Study revision and exam-plan data is scoped to the signed-in user and removed during account deletion.
- No new dependency and no original uploaded document files are retained.

## API
- `GET /api/study/reviews`
- `POST /api/study/reviews`
- `POST /api/study/reviews/:id/rate`
- `DELETE /api/study/reviews/:id`
- `GET /api/study/plans`
- `POST /api/study/plans`
- `PATCH /api/study/plans/:id/topics/:index`
- `DELETE /api/study/plans/:id`

## Notes
- Revision data is created from missed quiz questions and flashcards marked Again. It is not yet a full AI weak-topic classifier.
- Exam plans are currently a topic checklist with a daily-time target; automatic calendar time-block creation and push reminders are reserved for a later release.
