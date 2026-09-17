-- The migration installs both cron jobs. After securely provisioning the two
-- documented Vault secrets, run this non-secret deployment preflight.
select finance_private.tax_export_retention_preflight();
select jobname,schedule,active from cron.job
where jobname in ('tax-export-retention','tax-export-lease-recovery');
