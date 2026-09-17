-- Receipt metadata is intentionally removed before the private object so the
-- retryable client cleanup cannot leave a live database reference. The former
-- policy required metadata to exist and therefore made that safe sequence
-- impossible. This policy admits only an orphan whose owning expense still
-- belongs to this authenticated owner and remains in review.

drop policy if exists "owner deletes review expense document objects" on storage.objects;

create policy "owner deletes orphaned review expense document objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'expense-documents'
    and public.is_owner()
    and owner_id = auth.uid()::text
    and name ~ ('^' || auth.uid()::text || '/[0-9a-fA-F-]{36}/[^/]+$')
    and exists (
      select 1
      from public.expenses expense
      where expense.id = case
        when split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
          then split_part(name, '/', 2)::uuid
        else null
      end
        and expense.user_id = auth.uid()
        and expense.status = 'needs_review'
    )
    and not exists (
      select 1
      from public.expense_documents document
      where document.storage_path = name
    )
  );
