# FamilyTree V8 — Family Reels

## Goal
Add a family-only short-video feed while keeping the same user-specific family authorization model.

## Features
- Vertical reels feed
- Upload short videos
- Video thumbnail
- Caption
- Tagged family members
- Likes/reactions
- Comments
- Share inside family network
- Report reel
- Delete own reel
- Admin/moderator moderation
- Family-only visibility by default
- Optional selected-family visibility
- Optional public visibility later

## Storage architecture
Recommended Supabase Storage:
- `family-reels` bucket
- `family-reel-thumbnails` bucket

Keep storage objects private by default. Generate signed URLs for authorized viewers.

## Suggested tables

### reels
- id
- author_profile_id
- tree_id
- storage_path
- thumbnail_path
- caption
- duration_seconds
- visibility
- status
- created_at

### reel_reactions
- id
- reel_id
- profile_id
- reaction_type
- created_at
- unique(reel_id, profile_id)

### reel_comments
- id
- reel_id
- profile_id
- body
- created_at
- deleted_at

### reel_reports
- id
- reel_id
- reported_by
- reason
- status
- reviewed_by
- created_at

## Security
1. Viewer must have access to the reel's tree.
2. Private storage objects must not be directly public.
3. Uploaders can modify/delete only their own content.
4. Moderators can review reported content.
5. Admin does not automatically gain family membership.
6. Service-role keys stay server-side.

## Acceptance tests
1. Authorized family member can watch a reel.
2. Unauthorized user cannot obtain the private video URL.
3. User can upload a short video.
4. User can react and comment.
5. User can report a reel.
6. Moderator can hide reported content.
7. Deleted reel becomes unavailable.
8. Merged person content remains linked to the surviving person.
