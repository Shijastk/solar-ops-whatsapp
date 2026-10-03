-- Exact, bounded operational period summary for WhatsApp natural-language queries.

create or replace function public.get_ops_period_summary(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  bill_count bigint,
  verified_bill_count bigint,
  review_bill_count bigint,
  completed_trip_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with period_bills as (
    select m.id
    from public.whatsapp_messages m
    where m.message_type = 'document'
      and m.received_at >= p_start
      and m.received_at < p_end
      and (
        m.mime_type = 'application/pdf'
        or lower(coalesce(m.original_filename, '')) like '%.pdf'
      )
  ),
  bill_stats as (
    select
      count(*)::bigint as bill_count,
      count(*) filter (
        where d.workflow_status = 'recorded'
          and d.verification_status = 'verified'
      )::bigint as verified_bill_count,
      count(*) filter (
        where d.workflow_status = 'review_required'
      )::bigint as review_bill_count
    from period_bills b
    left join public.document_drafts d on d.message_id = b.id
  ),
  trip_stats as (
    select count(*)::bigint as completed_trip_count
    from public.delivery_trips t
    where t.status = 'ready'
      and t.finalized_at >= p_start
      and t.finalized_at < p_end
  )
  select
    b.bill_count,
    b.verified_bill_count,
    b.review_bill_count,
    t.completed_trip_count
  from bill_stats b
  cross join trip_stats t;
$$;

revoke all on function public.get_ops_period_summary(timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_ops_period_summary(timestamptz,timestamptz)
  to service_role;
