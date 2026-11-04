alter table public.plus_purchase_records
 add column if not exists receipt_path text,
 add column if not exists receipt_mime_type text,
 add column if not exists admin_note text not null default '',
 add column if not exists reviewed_at timestamptz;

create or replace function public.finalize_manual_plus_purchase(p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.plus_purchase_records%rowtype; m public.plus_memberships%rowtype; n integer; s timestamptz; e timestamptz; pct integer;
begin
 select * into p from public.plus_purchase_records where id=p_purchase_id for update;
 if not found then raise exception 'purchase_not_found'; end if;
 if p.payment_provider<>'card_transfer' then raise exception 'invalid_provider'; end if;
 if p.payment_status='paid' then return jsonb_build_object('ok',true,'duplicate',true); end if;
 if p.payment_status<>'pending' or p.receipt_path is null then raise exception 'invalid_purchase_state'; end if;
 insert into public.plus_memberships(user_id,email,status,starts_at,ends_at,purchase_count,discount_percent,last_purchase_at,updated_at)
 values(p.user_id,p.email,'inactive',null,null,0,35,null,now()) on conflict(user_id) do nothing;
 select * into m from public.plus_memberships where user_id=p.user_id for update;
 n:=m.purchase_count+1; pct:=case when n>=3 then 50 else 35 end;
 s:=greatest(now(),coalesce(m.ends_at,now()));
 if m.status<>'active' or m.ends_at is null or m.ends_at<=now() then s:=now(); end if;
 e:=s+interval '30 days';
 update public.plus_memberships set email=p.email,status='active',starts_at=s,ends_at=e,purchase_count=n,discount_percent=pct,last_purchase_at=now(),updated_at=now() where user_id=p.user_id;
 update public.plus_purchase_records set payment_status='paid',paid_at=now(),reviewed_at=now(),discount_percent=pct where id=p.id;
 return jsonb_build_object('ok',true,'purchase_count',n,'discount_percent',pct,'starts_at',s,'ends_at',e);
end $$;
revoke all on function public.finalize_manual_plus_purchase(uuid) from public,anon,authenticated;
grant execute on function public.finalize_manual_plus_purchase(uuid) to service_role;
