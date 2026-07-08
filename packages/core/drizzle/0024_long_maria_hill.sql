CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "kg_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"commit_sha" text,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"nodes_analyzed" integer DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"cost_credits" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"note" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kg_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"src_node_id" uuid NOT NULL,
	"dst_node_id" uuid NOT NULL,
	"relation" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kg_node_embeddings" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"build_id" uuid NOT NULL,
	"embedding" vector(768) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kg_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"business_flow" text,
	"digest" text,
	"code_ref_path" text,
	"code_ref_start" integer,
	"code_ref_end" integer,
	"commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kg_builds" ADD CONSTRAINT "kg_builds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_build_id_kg_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."kg_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_src_node_id_kg_nodes_id_fk" FOREIGN KEY ("src_node_id") REFERENCES "public"."kg_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_edges" ADD CONSTRAINT "kg_edges_dst_node_id_kg_nodes_id_fk" FOREIGN KEY ("dst_node_id") REFERENCES "public"."kg_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_node_embeddings" ADD CONSTRAINT "kg_node_embeddings_node_id_kg_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."kg_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_node_embeddings" ADD CONSTRAINT "kg_node_embeddings_build_id_kg_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."kg_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_nodes" ADD CONSTRAINT "kg_nodes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_nodes" ADD CONSTRAINT "kg_nodes_build_id_kg_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."kg_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kg_builds_org_repo" ON "kg_builds" USING btree ("org_id","repo_full_name");--> statement-breakpoint
CREATE INDEX "kg_builds_status" ON "kg_builds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kg_edges_src" ON "kg_edges" USING btree ("src_node_id");--> statement-breakpoint
CREATE INDEX "kg_edges_dst" ON "kg_edges" USING btree ("dst_node_id");--> statement-breakpoint
CREATE INDEX "kg_edges_build" ON "kg_edges" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "kg_nodes_org_repo" ON "kg_nodes" USING btree ("org_id","repo_full_name");--> statement-breakpoint
CREATE INDEX "kg_nodes_build" ON "kg_nodes" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "kg_nodes_build_kind" ON "kg_nodes" USING btree ("build_id","kind");