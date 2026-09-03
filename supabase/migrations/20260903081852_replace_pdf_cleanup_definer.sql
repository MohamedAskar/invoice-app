-- Replace the temporary SECURITY DEFINER cleanup helper with an RLS-only
-- Storage policy. An attempted PDF upload is removable only by its owner and
-- only while no invoice points at that exact immutable archive path.

revoke all on function public.discard_unarchived_invoice_pdf(uuid, text, text)
  from public, anon, authenticated;

drop function public.discard_unarchived_invoice_pdf(uuid, text, text);

create policy "owner deletes unarchived invoice upload"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'issued-invoices'
    and public.is_owner()
    and (storage.foldername(name))[1] = auth.uid()::text
    and owner_id = auth.uid()::text
    and name ~ ('^' || auth.uid()::text || '/[0-9a-fA-F-]{36}/[0-9a-f]{64}[.]pdf$')
    and not exists (
      select 1
      from public.invoices invoice
      where invoice.pdf_storage_path = name
    )
  );
