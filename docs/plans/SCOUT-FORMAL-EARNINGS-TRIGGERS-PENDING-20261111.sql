-- NOVELIGHT formal earning trigger activation. SEPARATE LATER OWNER APPROVAL REQUIRED.
-- DO NOT APPLY to active beta; registering these triggers can issue formal Points on new reads/comments.
-- Requires approved formal cutover, all formal wallet/LEVEL openings initialized,
-- verified private DB login/rights and earning functions installed.
-- This file is NOT auto-migrated and has NO effect until explicitly executed.

create trigger scout_formal_read_level_capture
after insert on public.valid_read_events
for each row execute function novelight_formal_private.on_valid_read_formal_draft();

create trigger scout_formal_comment_enqueue
after insert or update of episode_id on public.novel_comments
for each row execute function novelight_formal_private.on_episode_comment_formal_draft();

-- Service role may invoke approved private functions only after this explicit activation.
grant execute on function novelight_formal_private.credit_confirmed_formal_point_draft(uuid,timestamptz) to service_role;
grant execute on function novelight_formal_private.award_read_points_draft(uuid,timestamptz) to service_role;
grant execute on function novelight_formal_private.award_comment_points_draft(uuid,timestamptz) to service_role;
grant execute on function novelight_formal_private.review_comment_and_award_draft(uuid,timestamptz,boolean,text) to service_role;
grant execute on function novelight_formal_private.enqueue_earning_draft(text,uuid) to service_role;
grant execute on function novelight_formal_private.decide_earning_review_draft(uuid,boolean,text,uuid,uuid,text,bigint) to service_role;
grant execute on function novelight_formal_private.claim_earning_draft() to service_role;
grant execute on function novelight_formal_private.finish_earning_draft(text,uuid,uuid,text) to service_role;
grant execute on function novelight_formal_private.on_valid_read_formal_draft() to service_role;
grant execute on function novelight_formal_private.on_episode_comment_formal_draft() to service_role;
