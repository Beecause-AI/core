-- RCA teams: per-assistant team attributes (lead/contact-point flags, model tier, escalation model, saved graph layout). is_lead is a plain non-unique flag (multiple leads per project allowed).
ALTER TABLE "assistants" ADD COLUMN "is_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "is_contact_point" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "tier" text DEFAULT 'cheap' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "escalation_model" text;--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "graph_x" real;--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "graph_y" real;
