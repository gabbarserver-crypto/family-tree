# FamilyTree V6 — Family Wall & Events

## Goal
Add a private family social feed and automatic family events.

## Family Wall
Post types:
- Text
- Photo
- Video foundation
- Birthday
- Engagement
- Marriage
- New baby
- Anniversary
- Graduation
- Achievement
- Family announcement

## Feed rules
The feed is based on the logged-in user's authorized family network.
Admin accounts do not automatically appear as family members.

## Reactions and comments
- Like/reaction
- Comments
- Reply to comments
- Delete own content
- Report content
- Moderation queue

## Events
Important dates stored on Person profiles can generate:
- Birthday reminders
- Engagement anniversary
- Marriage anniversary
- Other custom family events

Users can create manual family events too.

## Privacy
Post/event visibility:
- Family only
- Selected family
- Private
- Public (optional)

Default: Family only.

## Suggested tables
posts
post_media
post_tags
comments
reactions
events
event_attendees
reports

## Acceptance tests
1. User sees only posts allowed by family permissions.
2. User can create a family post.
3. User can attach an authorized photo.
4. User can comment and react.
5. Birthday events are generated from DOB.
6. Marriage/engagement anniversaries can be generated from stored dates.
7. Users can create custom events.
8. Unauthorized users cannot read private posts.
9. Reported posts enter moderation.
10. Admin moderation does not change family membership.
