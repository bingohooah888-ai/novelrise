begin;

drop function if exists public.novelight_update_collaboration_episode(bigint,text,text);
drop function if exists public.novelight_create_collaboration_draft(bigint,text,text);
drop function if exists public.novelight_get_collaboration_episode(bigint);
drop function if exists public.novelight_list_collaboration_episodes(bigint);
drop function if exists public.novelight_leave_novel_collaboration(bigint);
drop function if exists public.novelight_remove_novel_collaborator(bigint,uuid);
drop function if exists public.novelight_accept_collaboration_invite(text);
drop function if exists public.novelight_revoke_collaboration_invite(bigint);
drop function if exists public.novelight_rotate_collaboration_invite(bigint);
drop function if exists public.novelight_manage_novel_collaborators(bigint);
drop function if exists public.novelight_list_my_collaborations();
drop function if exists public.novelight_collaboration_access(bigint);
drop function if exists public.novelight_collaboration_can_edit(bigint,uuid);

drop table if exists public.novel_collaboration_events;
drop table if exists public.novel_collaboration_invites;
drop table if exists public.novel_collaborators;

commit;
