CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TABLE "org_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"invited_by" text NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_members" ALTER COLUMN "role" SET DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_invitations_pending" ON "org_invitations" USING btree ("org_id","email") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "org_invitations_org" ON "org_invitations" USING btree ("org_id");
