-- Deployment-only configuration, intentionally outside migrations: provision
-- the documented Vault secrets and enable pg_cron/pg_net/Vault first.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'tax_export_project_url' and decrypted_secret like 'https://%')
    or not exists (select 1 from vault.decrypted_secrets where name = 'tax_export_service_role_key' and length(decrypted_secret) > 30) then
    raise exception 'Configure tax export URL and service-role JWT in Vault before scheduling cleanup';
  end if;
end;
$$;

select cron.schedule(
  'tax-export-retention',
  '*/5 * * * *',
  $schedule$
    select net.http_post(
      url := (select rtrim(decrypted_secret, '/') from vault.decrypted_secrets where name = 'tax_export_project_url') || '/functions/v1/create-tax-export',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tax_export_service_role_key')
      ),
      body := '{"mode":"cleanup"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $schedule$
);
