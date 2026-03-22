ALTER TABLE "farm_profiles" ADD COLUMN "centroid" geometry(Point,4326);--> statement-breakpoint
ALTER TABLE "farm_profiles" ADD COLUMN "geom" geometry(Polygon,4326);