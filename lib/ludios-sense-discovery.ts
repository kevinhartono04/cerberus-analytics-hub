import mapping from "@/data/ludios-sense/genre-map.json";
import type {SenseStore} from "./ludios-sense-types";

// Store-level categories, never unified categories: keep each store's coverage.
export const senseDiscoveryVersion="games-v1";
export const senseDiscoveryCategory=(store:SenseStore)=>store==="ios"?"6014":"game";
export const senseGenreOverrides=JSON.stringify(mapping.overrides);

// Mirrors classifySense's conservative retention rule. Unknown categories stay
// eligible for review; all game genres and explicit inclusion overrides survive.
// $3 contains the same override map used by the application classifier.
export const senseRetainedCandidatePredicate=`coalesce(
  ($3::text::jsonb -> (store || ':' || app_id) ->> 'status') <> 'excluded',
  jsonb_array_length(coalesce(payload->'categories','[]'::jsonb))=0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(payload->'categories') AS category(value)
    WHERE value='6014' OR value ~ '^70[0-9][0-9]$' OR value ~* '^game(_|$)'
  )
)`;
