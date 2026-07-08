-- Operation-level error message (visible in the super activity view); cleared on success.
ALTER TABLE "operations" ADD COLUMN "error" text;
