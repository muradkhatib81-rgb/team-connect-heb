create or replace function public.purge_message_global(_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not (public.has_role(auth.uid(), 'main_admin'::app_role)
          or public.has_delete_communications_perm(auth.uid())) then
    raise exception 'אין הרשאה למחיקה';
  end if;

  select title into v_title from public.messages where id = _message_id;
  if v_title is null then
    return;
  end if;

  delete from public.schedule_notifications
   where message like ('הודעה עודכנה: ' || v_title || '%');

  delete from public.messages where id = _message_id;
end;
$$;

create or replace function public.purge_announcement_global(_ann_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not (public.has_role(auth.uid(), 'main_admin'::app_role)
          or public.has_delete_communications_perm(auth.uid())) then
    raise exception 'אין הרשאה למחיקה';
  end if;

  select title into v_title from public.announcements where id = _ann_id;
  if v_title is null then
    return;
  end if;

  delete from public.schedule_notifications
   where message like ('הכרזה עודכנה: ' || v_title || '%');

  delete from public.announcements where id = _ann_id;
end;
$$;

grant execute on function public.purge_message_global(uuid) to authenticated;
grant execute on function public.purge_announcement_global(uuid) to authenticated;