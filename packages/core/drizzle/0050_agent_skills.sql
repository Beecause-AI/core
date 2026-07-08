-- Skills subsystem: project-level reusable instruction modules + assistant join table.
CREATE TABLE "agent_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_skills" (
	"assistant_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "assistant_skills_assistant_id_skill_id_pk" PRIMARY KEY("assistant_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_skills" ADD CONSTRAINT "assistant_skills_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_skills" ADD CONSTRAINT "assistant_skills_skill_id_agent_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."agent_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skills_project_name" ON "agent_skills" USING btree ("project_id","name");
