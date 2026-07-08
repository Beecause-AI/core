-- Hand-written: drizzle-kit cannot express an enum VALUE RENAME and generates a
-- destructive drop/recreate that fails on existing rows. RENAME VALUE keeps the
-- enum's physical representation, so all org_members rows (and the column
-- default) follow the rename with no data rewrite.
ALTER TYPE "public"."member_role" RENAME VALUE 'admin' TO 'manager';--> statement-breakpoint
ALTER TYPE "public"."member_role" RENAME VALUE 'member' TO 'user';
